//! PRD interview orchestration, prompt builders, and JSON salvage parsing.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::time::Duration;

use futures::StreamExt;
use serde::Deserialize;

use crate::db::dao::{interview_turn as interview_turn_dao, project as project_dao};
#[cfg(test)]
use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
};
use crate::db::models::{
    LiveProjectSpecDraftRow, NewInterviewTurn, PrdPatch, PrdPatchOperation, ProjectSpecDraft,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::ipc::AppState;
use crate::providers::{with_retry, ChatEvent, ChatRequest, FinishReason, Message, ToolChoice};
#[cfg(test)]
use std::collections::BTreeMap;

use super::*;

pub async fn workspace_prd_interview_turn_impl(
    state: &AppState,
    input: PrdInterviewTurnInput,
) -> Result<PrdInterviewTurnOutput, String> {
    if input.provider.trim().is_empty() {
        return Err("provider is required for PRD interview turn".into());
    }
    if input.model.trim().is_empty() {
        return Err("model is required for PRD interview turn".into());
    }
    let base_draft = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::get_by_id(db.conn(), input.project_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("project {} not found", input.project_id))?;
        load_or_create_prd_draft(db.conn(), input.project_id, &input.draft_id)?
    };

    let runtime = state.ensure_provider_runtime().await?;
    let (raw, turn_finish_reason) = run_prd_interview_turn(
        runtime.provider.as_ref(),
        input.model.clone(),
        &base_draft,
        &input.conversation,
        &input.answer,
        false,
    )
    .await?;
    let turn_id = format!("prd-turn-{}", now_ms());
    let mut parsed = parse_prd_turn_response(&raw, &turn_id);
    // 011 재QA 2차: audit which structuring failures were actually response
    // truncation — a Length finish means the model may have been cut before
    // its JSON started, which is invisible in the raw text alone.
    let mut parse_failure_kind: Option<String> = parsed
        .parse_failure_kind
        .map(|kind| kind_with_truncation(kind, turn_finish_reason));
    // 011 S-057 GO 게이트 FAIL (s057-go-run-log 회차 1): some models violate
    // the JSON output contract nondeterministically (long prose first, JSON
    // truncated away — no_json_truncated even at a raised token budget). One
    // deterministic in-turn retry with a hard contract reminder makes a
    // single student answer robust across models; the audit trail records
    // both the flake and the recovery. Genuine no-op turns (no parse failure)
    // never retry, and a retry transport error keeps the salvaged first
    // result instead of failing the turn.
    if parsed.parse_failure_kind.is_some() {
        if let Ok((retry_raw, retry_finish)) = run_prd_interview_turn(
            runtime.provider.as_ref(),
            input.model.clone(),
            &base_draft,
            &input.conversation,
            &input.answer,
            true,
        )
        .await
        {
            let retry_parsed = parse_prd_turn_response(&retry_raw, &turn_id);
            match retry_parsed.parse_failure_kind {
                None => {
                    parse_failure_kind = parse_failure_kind.map(|kind| format!("{kind}:recovered"));
                    parsed = retry_parsed;
                }
                Some(retry_kind) => {
                    parse_failure_kind = parse_failure_kind.map(|kind| {
                        format!(
                            "{kind}:retry_{}",
                            kind_with_truncation(retry_kind, retry_finish)
                        )
                    });
                    parsed = retry_parsed;
                }
            }
        }
    }
    let assistant_message = parsed
        .assistant_message
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_default();
    let patch = parsed.patch;
    // S-047: only surface the AI's architecture cards when the draft is actually
    // on that focus (the model was asked to answer it). Architecture is not
    // patchable, so the base draft's focus is authoritative here.
    let expected_proposal_kind = expected_architecture_proposal_kind(&base_draft.spec);
    let architecture_proposals = parsed
        .proposals
        .filter(|proposals| Some(proposals.kind.as_str()) == expected_proposal_kind);

    let mut output = PrdInterviewTurnOutput {
        turn_id: turn_id.clone(),
        assistant_message,
        patch: patch.clone(),
        validation_outcome: "none".into(),
        applied_field_paths: Vec::new(),
        rejected_reasons: Vec::new(),
        live_draft: base_draft,
        architecture_proposals,
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let current_draft = load_or_create_prd_draft(conn, input.project_id, &input.draft_id)?;
    // Carries the full flake/recovery history onto the InterviewTurn row even
    // when the in-turn retry recovered and the patch applied (e.g.
    // "no_json_truncated:recovered") — the audit must record the flake, not
    // just the final outcome.
    let turn_parse_failure_kind: Option<String> = parse_failure_kind.clone();
    if let Some(patch) = patch {
        let operation_kinds = patch
            .operations
            .iter()
            .map(|operation| operation.op.clone())
            .collect::<Vec<_>>();
        dive_event_log::append_to_conn(
            conn,
            None,
            dive_event_log::PRD_PATCH_PROPOSED_EVENT,
            dive_event_log::prd_patch_proposed_payload(
                input.project_id,
                project_spec_id_for_draft(&current_draft),
                current_draft.draft_id.clone(),
                turn_id.clone(),
                patch.patch_id.clone(),
                operation_kinds,
                patch.rationale.clone(),
            ),
        )
        .map_err(|e| e.to_string())?;

        let applied = apply_prd_patch_to_draft(current_draft, &patch);
        output.validation_outcome = applied.validation_outcome.clone();
        output.applied_field_paths = applied.applied_field_paths.clone();
        output.rejected_reasons = applied.rejected_reasons.clone();
        output.live_draft = applied.draft.clone();
        persist_live_prd_draft(conn, &applied.draft)?;

        if applied.validation_outcome == "applied" {
            dive_event_log::append_to_conn(
                conn,
                None,
                dive_event_log::PRD_PATCH_APPLIED_EVENT,
                dive_event_log::prd_patch_applied_payload(
                    input.project_id,
                    project_spec_id_for_draft(&applied.draft),
                    applied.draft.draft_id.clone(),
                    turn_id.clone(),
                    patch.patch_id,
                    applied.applied_field_paths,
                    applied.criterion_ids_assigned,
                    applied.student_edited_fields_respected,
                ),
            )
            .map_err(|e| e.to_string())?;
        } else if applied.validation_outcome == "rejected"
            || applied.validation_outcome == "held_for_student"
        {
            dive_event_log::append_to_conn(
                conn,
                None,
                dive_event_log::PRD_PATCH_REJECTED_EVENT,
                dive_event_log::prd_patch_rejected_payload(
                    input.project_id,
                    project_spec_id_for_draft(&applied.draft),
                    applied.draft.draft_id,
                    turn_id.clone(),
                    patch.patch_id,
                    applied.rejected_reasons,
                    applied.validation_outcome == "held_for_student",
                ),
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        // S-053 D1: `patch: None` used to leave the default "none" outcome
        // unconditionally — the same status as a benign net-zero patch, and no
        // EventLog event fired at all. A structuring failure (no JSON, or JSON
        // that decodes as neither response shape) now gets its own outcome and
        // an auditable event; a turn that structured fine but genuinely
        // proposed nothing (no `patch` key in the parsed response) still stays
        // "none".
        if let Some(kind) = parse_failure_kind {
            output.validation_outcome = "not_structured".into();
            dive_event_log::append_to_conn(
                conn,
                None,
                dive_event_log::PRD_PATCH_UNSTRUCTURED_EVENT,
                dive_event_log::prd_patch_unstructured_payload(
                    input.project_id,
                    project_spec_id_for_draft(&current_draft),
                    current_draft.draft_id.clone(),
                    turn_id.clone(),
                    kind,
                    input.provider.clone(),
                    input.model.clone(),
                ),
            )
            .map_err(|e| e.to_string())?;
        }
        // S-064 G4: a no-patch turn must NOT re-persist `output.live_draft` —
        // that draft was captured (`base_draft`) *before* the LLM call, so if
        // the student edited the draft while the model was running, rewriting it
        // here silently reverts that concurrent edit. `current_draft` is the row
        // as it stands now (edits included); nothing changed this turn, so leave
        // the DB alone and hand the authoritative current draft back to the
        // caller instead of the stale snapshot.
        output.live_draft = current_draft;
    }

    interview_turn_dao::insert(
        conn,
        &NewInterviewTurn {
            draft_id: output.live_draft.draft_id.clone(),
            turn_id,
            student_answer: input.answer,
            outcome: prd_validation_outcome_enum(&output.validation_outcome),
            parse_failure_kind: turn_parse_failure_kind,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(output)
}

async fn run_prd_interview_turn(
    provider: &dyn crate::providers::LlmProvider,
    model: String,
    draft: &LiveProjectSpecDraftRow,
    conversation: &[PrdInterviewConversationTurnInput],
    answer: &str,
    json_contract_retry: bool,
) -> Result<(String, FinishReason), String> {
    let mut user_prompt = build_prd_interview_user_prompt(draft, conversation, answer);
    if json_contract_retry {
        // 011 S-057: hard reminder for the deterministic in-turn retry after a
        // structuring failure — the previous attempt violated the contract.
        user_prompt.push_str(
            "\n\nIMPORTANT: your previous reply violated the output contract. Respond with ONLY one JSON object now — the very first character of your reply must be '{'. No prose, no Markdown fences, no text outside the JSON.",
        );
    }
    let req = ChatRequest {
        model,
        messages: vec![
            Message::System {
                content: build_prd_interview_system_prompt(),
            },
            Message::User {
                content: user_prompt,
            },
        ],
        tools: None,
        tool_choice: Some(ToolChoice::None),
        temperature: Some(0.2),
        // 011 재QA 2차→S-057 GO 게이트: 900 then 2400 both truncated on
        // claude-sonnet-5 (no_json_truncated in the audit trail) — a
        // reasoning-heavy model can spend thinking budget AND write a long
        // Korean prose lead-in before its JSON. 8000 gives real headroom so a
        // contract-disobeying-but-eventually-JSON reply still completes (the
        // parser extracts the JSON span from surrounding prose).
        max_tokens: Some(8000),
    };
    let mut stream = with_retry(
        || {
            let req = req.clone();
            provider.chat(req)
        },
        2,
        Duration::from_millis(350),
    )
    .await
    .map_err(|e| e.to_string())?;
    let mut text = String::new();
    let mut finish_reason = FinishReason::Stop;
    while let Some(event) = stream.next().await {
        match event {
            ChatEvent::TextDelta(delta) => text.push_str(&delta),
            ChatEvent::Done {
                finish_reason: done,
            } => {
                finish_reason = done;
                break;
            }
            ChatEvent::Error(err) => return Err(err),
            ChatEvent::ReasoningDelta(_)
            | ChatEvent::ToolCallStart { .. }
            | ChatEvent::ToolCallDelta { .. }
            | ChatEvent::ToolCallEnd { .. }
            | ChatEvent::Usage { .. } => {}
        }
    }
    if finish_reason == FinishReason::Error {
        return Err("PRD interview provider finished with an error".into());
    }
    Ok((text, finish_reason))
}

fn build_prd_interview_system_prompt() -> String {
    [
        "You are helping a novice author a real project PRD inside DIVE through a relaxed conversation.",
        "Assume the student has never written a PRD and does not know what PRD fields mean.",
        "You own the interview flow: gently lead the student from vague idea to a complete-enough PRD.",
        "Do not run a fixed checklist, quiz, or wizard. Do not ask the student to fill PRD fields.",
        "Use the same language as the student's answer unless the draft clearly uses another language.",
        "On every turn, infer useful PRD details from casual wording and update the draft with a patch when evidence is present.",
        "If something important is missing, ask at most one concrete follow-up question in ordinary product language.",
        "Do not ask jargon questions like 'what are the acceptance criteria?' or 'what is the scope?'. Ask about visible outcomes, first version, users, constraints, or what can wait.",
        "assistantMessage should briefly reflect what you captured, explain the next useful angle, then continue warmly.",
        "Prefer concrete user outcomes and observable done states over PRD jargon.",
        "The user message includes a 'Suggested next interview focus' computed from the real confirm gate. Follow it: while it names a missing field, ask exactly one concrete, plain-language question to draw that out — who it is for and why, what the first version should include, what to leave out for now, and concrete observable signs it works — never as jargon, a checklist, or field names.",
        "Only when the focus is ready_to_save is the PRD complete enough. Until then, do NOT tell the student it is ready or to confirm. When it is ready, stop asking required questions and tell the student it is ready, pointing them to the \"PRD 확정\" / \"Confirm PRD\" button by that exact name.",
        "Return a short conversational assistantMessage and an optional JSON patch.",
        "The patch may only use these operation names: set_goal, set_intent_summary, append_scope, append_non_goal, append_constraint, append_acceptance_criterion, revise_acceptance_criterion_text.",
        "Each patch operation object MUST use the key \"op\" for the operation name; do not use \"operation\".",
        "For append_acceptance_criterion and revise_acceptance_criterion_text, put the criterion wording in \"text\".",
        "Do not invent IDs for new criteria; DIVE assigns AC IDs.",
        "Never put the architecture (form or tech stack) in the patch — the student decides it by clicking a card, not you.",
        "When the suggested next focus is propose_architecture_form or propose_architecture_stack, ALSO return a \"proposals\" object recommending up to 2 options for that focus, each with a one-line beginner reason, and still ask the student to pick or change one in assistantMessage.",
        "For propose_architecture_form, use \"proposals\":{\"kind\":\"form\",\"options\":[{\"value\":\"<one of: web_app, static_page, cli_tool, desktop_app, api_service, other>\",\"rationale\":\"...\"}]}.",
        "For propose_architecture_stack, use \"proposals\":{\"kind\":\"stack\",\"options\":[{\"value\":\"<concise stack, e.g. React + Vite>\",\"rationale\":\"...\"}]}. Only recommend stacks that fit the already chosen form.",
        "Omit \"proposals\" entirely on any other focus.",
        "Use concise JSON with shape {\"assistantMessage\":\"...\",\"patch\":{\"operations\":[...],\"rationale\":\"...\"},\"proposals\":{\"kind\":\"...\",\"options\":[...]}}. Include only the keys you are using.",
        // 011 live-QA fix (tier1-run-log 2026-07-11 저니 C): without an
        // explicit whole-response contract, some models (observed with
        // claude-sonnet-5) reply in plain prose — no JSON at all — so no
        // patch can ever be extracted and every detailed answer dies as
        // `not_structured`/`no_json`. Same lesson as the review-card schema
        // fix: name the exact output envelope, always.
        "CRITICAL OUTPUT CONTRACT: your ENTIRE reply must be exactly one JSON object and nothing else — no prose before or after it, no Markdown code fences. The conversational reply always goes inside the assistantMessage field, never outside the JSON. Even when you have no patch or proposals this turn, still reply with {\"assistantMessage\":\"...\"}.",
    ]
    .join("\n")
}

fn build_prd_interview_user_prompt(
    draft: &LiveProjectSpecDraftRow,
    conversation: &[PrdInterviewConversationTurnInput],
    answer: &str,
) -> String {
    let draft_json = serde_json::to_string(&draft.spec).unwrap_or_else(|_| "{}".into());
    let missing_confirmable = missing_confirmable_prd_fields(&draft.spec).join(", ");
    let next_focus = prd_interview_next_focus(&draft.spec);
    let conversation = format_prd_interview_conversation(conversation);
    format!(
        "Current live PRD draft JSON:\n{draft_json}\n\nMissing fields required before PRD confirmation, if any: {missing_confirmable}\n\nSuggested next interview focus: {next_focus}\n\nRecent interview conversation, oldest to newest:\n{conversation}\n\nLatest student answer:\n{answer}\n\nReply with exactly one JSON object per the system-prompt output contract (assistantMessage inside the JSON; optional patch/proposals keys). Use the recent conversation as evidence when the live draft has not caught up yet. Do not repeat a question that the student has already answered in the conversation. If the answer is vague, still capture any likely goal, user, first-version boundary, constraint, or observable done state that is grounded in the answer. If the suggested focus is ready_to_save, say the PRD has enough information to confirm and point the student to the \"PRD 확정\" / \"Confirm PRD\" button instead of asking a new required question, offering another wording pass, or asking whether to save. If the suggested focus names a missing field, ask one concrete plain-language question for that field and do not tell the student it is ready to confirm yet."
    )
}

fn format_prd_interview_conversation(conversation: &[PrdInterviewConversationTurnInput]) -> String {
    let turns = conversation
        .iter()
        .filter_map(|turn| {
            let text = turn.text.trim();
            if text.is_empty() {
                return None;
            }
            let role = match turn.role.as_str() {
                "assistant" => "Assistant",
                "student" => "Student",
                _ => return None,
            };
            Some(format!("{role}: {text}"))
        })
        .rev()
        .take(12)
        .collect::<Vec<_>>();
    if turns.is_empty() {
        return "None yet.".into();
    }
    turns.into_iter().rev().collect::<Vec<_>>().join("\n")
}

pub(super) fn missing_confirmable_prd_fields(spec: &ProjectSpecDraft) -> Vec<&'static str> {
    let gaps = confirmable_draft_gaps(spec);
    if gaps.is_empty() {
        return vec!["none"];
    }
    gaps.into_iter().map(|gap| gap.label).collect()
}

pub(super) fn prd_interview_next_focus(spec: &ProjectSpecDraft) -> &'static str {
    match confirmable_draft_gaps(spec).first() {
        Some(gap) => gap.focus,
        None => "ready_to_save: the draft is complete enough; point to the PRD confirmation action",
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdTurnResponse {
    assistant_message: Option<String>,
    patch: Option<RawPrdPatch>,
    // S-047: optional architecture recommendation surface (form/stack). Never a
    // patch — the architecture is applied only by the student's card click.
    proposals: Option<RawPrdProposals>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdProposals {
    kind: Option<String>,
    #[serde(default)]
    options: Vec<RawPrdProposalOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdProposalOption {
    value: Option<String>,
    rationale: Option<String>,
}

impl RawPrdProposals {
    /// Shape-validate the AI's raw proposals: keep only `form`/`stack` kinds,
    /// drop options with an empty value, coerce `form` values to the bounded
    /// `ArchitectureForm` enum (dropping unknown forms), trim wording, and cap
    /// at two options. Returns `None` when nothing usable remains. The
    /// current-focus gate is applied separately by the caller.
    fn into_sanitized(self) -> Option<ArchitectureProposals> {
        let kind = match self.kind.as_deref().map(str::trim) {
            Some("form") => "form",
            Some("stack") => "stack",
            _ => return None,
        };
        let options: Vec<ArchitectureProposalOption> = self
            .options
            .into_iter()
            .filter_map(|option| {
                let value = option.value?.trim().to_string();
                if value.is_empty() {
                    return None;
                }
                if kind == "form" && !is_valid_architecture_form_value(&value) {
                    return None;
                }
                let rationale = option
                    .rationale
                    .map(|r| r.trim().to_string())
                    .unwrap_or_default();
                Some(ArchitectureProposalOption { value, rationale })
            })
            .take(2)
            .collect();
        if options.is_empty() {
            return None;
        }
        Some(ArchitectureProposals {
            kind: kind.to_string(),
            options,
        })
    }
}

/// True when `value` is one of the bounded `ArchitectureForm` snake_case values,
/// so an AI form recommendation maps onto a card the student can actually pick.
fn is_valid_architecture_form_value(value: &str) -> bool {
    matches!(
        value,
        "web_app" | "static_page" | "cli_tool" | "desktop_app" | "api_service" | "other"
    )
}

/// The architecture focus the current draft is on, if any: `Some("form")` when
/// the next confirm gap is the architecture form, `Some("stack")` when it is the
/// tech stack, else `None`. Used to gate AI proposals to the deterministic focus
/// the model was asked to answer, so stale/off-focus cards never surface.
fn expected_architecture_proposal_kind(spec: &ProjectSpecDraft) -> Option<&'static str> {
    match confirmable_draft_gaps(spec).first() {
        Some(gap) if gap.focus.starts_with("propose_architecture_form") => Some("form"),
        Some(gap) if gap.focus.starts_with("propose_architecture_stack") => Some("stack"),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdPatch {
    operations: Vec<RawPrdPatchOperation>,
    rationale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdPatchOperation {
    #[serde(alias = "operation")]
    op: String,
    value: Option<String>,
    text: Option<String>,
    #[serde(alias = "criterion_id")]
    criterion_id: Option<String>,
}

impl RawPrdPatchOperation {
    fn into_prd_operation(self) -> PrdPatchOperation {
        let RawPrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
        } = self;
        let value = match op.as_str() {
            "set_goal" | "set_intent_summary" | "append_scope" | "append_non_goal"
            | "append_constraint" => value.or_else(|| text.clone()),
            _ => value,
        };
        let text = match op.as_str() {
            "append_acceptance_criterion" | "revise_acceptance_criterion_text" => {
                text.or_else(|| value.clone())
            }
            _ => text,
        };
        // S-047: the AI interview patch never carries an architecture decision — the
        // architecture is set only through the student's draft-save path (no AI
        // auto-finalize), so there is no `set_architecture` patch op to build here.
        PrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
        }
    }
}

impl RawPrdPatch {
    fn into_prd_patch(self, turn_id: &str) -> PrdPatch {
        PrdPatch {
            patch_id: format!("prd-patch-{}", now_ms()),
            operations: self
                .operations
                .into_iter()
                .map(RawPrdPatchOperation::into_prd_operation)
                .collect(),
            rationale: self.rationale,
            source_turn_id: turn_id.to_string(),
        }
    }
}

/// S-053 D1: on a `patch: None` result, the two ways parsing can fail are kept
/// distinct via `parse_failure_kind` — `no_json` (no JSON object found at
/// all) vs `undecodable_json` (a JSON object was found but decodes as neither
/// `RawPrdTurnResponse` nor the bare `RawPrdPatch` shape). `None` here means
/// the model's response DID structure successfully (it just had nothing to
/// patch), which the caller must not treat as a structuring failure.
fn parse_prd_turn_response(raw: &str, turn_id: &str) -> ParsedPrdTurn {
    let Some(json_text) = extract_prd_turn_json_candidate(raw) else {
        return ParsedPrdTurn {
            assistant_message: clean_prd_assistant_message(raw),
            patch: None,
            proposals: None,
            parse_failure_kind: Some("no_json"),
        };
    };
    if let Ok(response) = serde_json::from_str::<RawPrdTurnResponse>(json_text) {
        return ParsedPrdTurn {
            assistant_message: response.assistant_message.and_then(|message| {
                clean_prd_assistant_message(&strip_prd_json_payloads(&message))
            }),
            patch: response.patch.map(|patch| patch.into_prd_patch(turn_id)),
            proposals: response.proposals.and_then(RawPrdProposals::into_sanitized),
            parse_failure_kind: None,
        };
    }
    if let Ok(patch) = serde_json::from_str::<RawPrdPatch>(json_text) {
        return ParsedPrdTurn {
            assistant_message: clean_prd_assistant_message(&raw.replace(json_text, "")),
            patch: Some(patch.into_prd_patch(turn_id)),
            proposals: None,
            parse_failure_kind: None,
        };
    }
    ParsedPrdTurn {
        assistant_message: clean_prd_assistant_message(&strip_prd_json_payloads(raw)),
        patch: None,
        proposals: None,
        parse_failure_kind: Some("undecodable_json"),
    }
}

struct ParsedPrdTurn {
    assistant_message: Option<String>,
    patch: Option<PrdPatch>,
    proposals: Option<ArchitectureProposals>,
    parse_failure_kind: Option<&'static str>,
}

fn extract_prd_turn_json_candidate(raw: &str) -> Option<&str> {
    let spans = json_object_spans(raw);
    for (start, end) in spans.iter().copied() {
        let candidate = &raw[start..end];
        if serde_json::from_str::<RawPrdTurnResponse>(candidate).is_ok()
            || serde_json::from_str::<RawPrdPatch>(candidate).is_ok()
        {
            return Some(candidate);
        }
    }
    spans
        .iter()
        .copied()
        .find(|(start, end)| raw[*start..*end].contains("\"operations\""))
        .map(|(start, end)| &raw[start..end])
}

fn json_object_spans(raw: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start_index) = start.take() {
                        spans.push((start_index, index + ch.len_utf8()));
                    }
                }
            }
            _ => {}
        }
    }

    spans
}

fn strip_prd_json_payloads(raw: &str) -> String {
    let spans = json_object_spans(raw);
    if spans.is_empty() {
        return raw.to_string();
    }
    let mut cleaned = String::with_capacity(raw.len());
    let mut cursor = 0;
    for (start, end) in spans {
        if start > cursor {
            cleaned.push_str(&raw[cursor..start]);
        }
        cursor = end;
    }
    if cursor < raw.len() {
        cleaned.push_str(&raw[cursor..]);
    }
    cleaned
}

fn clean_prd_assistant_message(raw: &str) -> Option<String> {
    let without_fences = raw
        .replace("```json", "")
        .replace("```JSON", "")
        .replace("```", "");
    let before_patch = without_fences
        .find("\"patch\"")
        .map(|index| &without_fences[..index])
        .unwrap_or(without_fences.as_str());
    let cleaned = before_patch
        .trim()
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | ',' | ':' | '{' | '}' | '[' | ']' | '`')
        })
        .trim();
    if cleaned.is_empty()
        || cleaned.contains("\"operations\"")
        || cleaned.contains("\"operation\"")
        || cleaned.contains("\"assistantMessage\"")
    {
        None
    } else {
        Some(cleaned.to_string())
    }
}

#[cfg(test)]
mod prd_interview_prompt_tests {
    use super::*;
    use crate::db::models::{
        ArchitectureDecision, ArchitectureDecisionSource, ArchitectureForm, ProjectSpecDraft,
        ProjectSpecStatus,
    };

    fn empty_draft() -> LiveProjectSpecDraftRow {
        LiveProjectSpecDraftRow {
            draft_id: "draft-1".into(),
            project_id: 1,
            base_version: None,
            spec: ProjectSpecDraft {
                project_spec_id: Some("prd-1".into()),
                project_id: 1,
                current_version: None,
                goal: String::new(),
                intent_summary: None,
                scope: Vec::new(),
                non_goals: Vec::new(),
                constraints: Vec::new(),
                acceptance_criteria: Vec::new(),
                architecture: None,
                status: ProjectSpecStatus::Draft,
            },
            dirty_fields: Vec::new(),
            student_edited_fields: Vec::new(),
            last_patch_id: None,
            field_provenance: BTreeMap::new(),
            updated_at: 1,
        }
    }

    #[test]
    fn prd_interview_prompt_includes_recent_conversation_to_avoid_loops() {
        let prompt = build_prd_interview_user_prompt(
            &empty_draft(),
            &[
                PrdInterviewConversationTurnInput {
                    role: "assistant".into(),
                    text: "Who needs this first?".into(),
                },
                PrdInterviewConversationTurnInput {
                    role: "student".into(),
                    text: "Teachers checking late submissions.".into(),
                },
            ],
            "They need a dashboard.",
        );

        assert!(prompt.contains("Recent interview conversation"));
        assert!(prompt.contains("Assistant: Who needs this first?"));
        assert!(prompt.contains("Student: Teachers checking late submissions."));
        assert!(prompt.contains("Do not repeat a question that the student has already answered"));
        assert!(prompt.contains("Latest student answer:\nThey need a dashboard."));
    }

    #[test]
    fn prd_interview_not_ready_until_confirmable_bar_met() {
        // Goal + a single criterion is NOT enough: the real confirm gate
        // (validateConfirmableProjectSpec) also needs intent, >=1 scope, >=1
        // non-goal, and a second criterion. The interview readiness signal must
        // mirror that so DIVE does not tell the student to confirm while the
        // button is disabled (round-2 S-041 / P1-09, P1-10).
        let mut draft = empty_draft();
        draft.spec.goal = "Build a personal schedule app".into();
        draft.spec.acceptance_criteria.push(AcceptanceCriterion {
            criterion_id: "AC-001".into(),
            text: "Schedules and tasks appear in separate lists".into(),
            source: AcceptanceCriterionSource::Interview,
            status: AcceptanceCriterionStatus::Active,
            created_in_version: 1,
            retired_in_version: None,
        });

        assert_ne!(
            prd_interview_next_focus(&draft.spec),
            "ready_to_save: the draft is complete enough; point to the PRD confirmation action"
        );
        // The interview asks for the next genuinely-missing field, one at a time.
        assert!(prd_interview_next_focus(&draft.spec).starts_with("capture_intent_summary"));
        let missing = missing_confirmable_prd_fields(&draft.spec);
        assert!(missing.contains(&"intent summary"));
        assert!(missing.contains(&"in-scope item"));
        assert!(missing.contains(&"non-goal"));
        assert!(missing.contains(&"second observable done state"));
        assert!(!missing.contains(&"none"));
    }

    #[test]
    fn prd_interview_ready_only_when_confirmable_bar_met() {
        let mut draft = empty_draft();
        draft.spec.goal = "Build a personal schedule app for students".into();
        draft.spec.intent_summary =
            Some("A student tracks classes and homework in one place".into());
        draft.spec.scope = vec!["Add and remove schedule items".into()];
        draft.spec.non_goals = vec!["No account or login in the first version".into()];
        for (idx, text) in [
            "Schedules and tasks appear in separate lists",
            "Adding an item shows it immediately in the list",
        ]
        .iter()
        .enumerate()
        {
            draft.spec.acceptance_criteria.push(AcceptanceCriterion {
                criterion_id: format!("AC-{:03}", idx + 1),
                text: (*text).into(),
                source: AcceptanceCriterionSource::Interview,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: 1,
                retired_in_version: None,
            });
        }

        // S-047: after the 5 confirmable fields, the interview asks for the
        // architecture — a draft without one is NOT yet ready to confirm.
        assert!(prd_interview_next_focus(&draft.spec).starts_with("propose_architecture_form"));

        // Once a form is picked but no stack yet, it asks for the stack next.
        draft.spec.architecture = Some(ArchitectureDecision {
            form: ArchitectureForm::WebApp,
            form_other_label: None,
            stack: None,
            rationale: Some("A web app fits a schedule the student opens in a browser".into()),
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert!(prd_interview_next_focus(&draft.spec).starts_with("propose_architecture_stack"));
        assert!(missing_confirmable_prd_fields(&draft.spec).contains(&"tech stack"));

        // With both form and stack decided, the draft is ready to confirm.
        draft.spec.architecture = Some(ArchitectureDecision {
            form: ArchitectureForm::WebApp,
            form_other_label: None,
            stack: Some("React + Vite + TypeScript".into()),
            rationale: Some("A web app fits a schedule the student opens in a browser".into()),
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert_eq!(
            prd_interview_next_focus(&draft.spec),
            "ready_to_save: the draft is complete enough; point to the PRD confirmation action"
        );
        // Constraints remain optional (validateConfirmableProjectSpec ignores them).
        let prompt = build_prd_interview_user_prompt(&draft, &[], "이 정도면 충분해");
        assert!(prompt.contains("Missing fields required before PRD confirmation, if any: none"));
        assert!(prompt.contains("instead of asking a new required question"));
    }

    /// A draft that has cleared the five confirmable fields, so the interview is
    /// on the architecture-form focus (S-047 stage one).
    fn draft_on_form_focus() -> LiveProjectSpecDraftRow {
        let mut draft = empty_draft();
        draft.spec.goal = "Build a personal schedule app for students".into();
        draft.spec.intent_summary =
            Some("A student tracks classes and homework in one place".into());
        draft.spec.scope = vec!["Add and remove schedule items".into()];
        draft.spec.non_goals = vec!["No account or login in the first version".into()];
        for (idx, text) in [
            "Schedules and tasks appear in separate lists",
            "Adding an item shows it immediately in the list",
        ]
        .iter()
        .enumerate()
        {
            draft.spec.acceptance_criteria.push(AcceptanceCriterion {
                criterion_id: format!("AC-{:03}", idx + 1),
                text: (*text).into(),
                source: AcceptanceCriterionSource::Interview,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: 1,
                retired_in_version: None,
            });
        }
        draft
    }

    #[test]
    fn expected_proposal_kind_tracks_two_stage_focus() {
        // No architecture yet -> stage one (form).
        let mut draft = draft_on_form_focus();
        assert_eq!(
            expected_architecture_proposal_kind(&draft.spec),
            Some("form")
        );

        // Form picked, no stack -> stage two (stack).
        draft.spec.architecture = Some(ArchitectureDecision {
            form: ArchitectureForm::WebApp,
            form_other_label: None,
            stack: None,
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert_eq!(
            expected_architecture_proposal_kind(&draft.spec),
            Some("stack")
        );

        // Both decided -> no architecture focus, so no cards.
        draft.spec.architecture = Some(ArchitectureDecision {
            form: ArchitectureForm::WebApp,
            form_other_label: None,
            stack: Some("React + Vite".into()),
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert_eq!(expected_architecture_proposal_kind(&draft.spec), None);

        // A draft still missing earlier fields is not on an architecture focus.
        assert_eq!(
            expected_architecture_proposal_kind(&empty_draft().spec),
            None
        );
    }

    #[test]
    fn sanitize_form_proposals_keeps_valid_forms_and_caps_two() {
        let raw = RawPrdProposals {
            kind: Some("form".into()),
            options: vec![
                RawPrdProposalOption {
                    value: Some("  web_app ".into()),
                    rationale: Some(" Opens in a browser ".into()),
                },
                RawPrdProposalOption {
                    // Unknown form value is dropped, not coerced.
                    value: Some("mobile_app".into()),
                    rationale: Some("n/a".into()),
                },
                RawPrdProposalOption {
                    value: Some("static_page".into()),
                    rationale: None,
                },
                RawPrdProposalOption {
                    value: Some("cli_tool".into()),
                    rationale: Some("would be third".into()),
                },
            ],
        };
        let sanitized = raw.into_sanitized().expect("valid form options remain");
        assert_eq!(sanitized.kind, "form");
        assert_eq!(sanitized.options.len(), 2);
        assert_eq!(sanitized.options[0].value, "web_app");
        assert_eq!(sanitized.options[0].rationale, "Opens in a browser");
        assert_eq!(sanitized.options[1].value, "static_page");
        assert_eq!(sanitized.options[1].rationale, "");
    }

    #[test]
    fn sanitize_stack_proposals_keep_free_text() {
        let raw = RawPrdProposals {
            kind: Some("stack".into()),
            options: vec![
                RawPrdProposalOption {
                    value: Some("React + Vite".into()),
                    rationale: Some("Beginner-friendly".into()),
                },
                RawPrdProposalOption {
                    value: Some("   ".into()),
                    rationale: Some("blank value dropped".into()),
                },
            ],
        };
        let sanitized = raw.into_sanitized().expect("stack option remains");
        assert_eq!(sanitized.kind, "stack");
        assert_eq!(sanitized.options.len(), 1);
        assert_eq!(sanitized.options[0].value, "React + Vite");
    }

    #[test]
    fn sanitize_rejects_unknown_kind_and_empty_options() {
        assert!(RawPrdProposals {
            kind: Some("architecture".into()),
            options: vec![RawPrdProposalOption {
                value: Some("web_app".into()),
                rationale: None,
            }],
        }
        .into_sanitized()
        .is_none());

        assert!(RawPrdProposals {
            kind: Some("form".into()),
            options: vec![RawPrdProposalOption {
                value: Some("mobile_app".into()),
                rationale: None,
            }],
        }
        .into_sanitized()
        .is_none());
    }

    #[test]
    fn parse_turn_response_extracts_proposals_alongside_message() {
        let raw = r#"{"assistantMessage":"어떤 형태가 좋을까요?","proposals":{"kind":"form","options":[{"value":"web_app","rationale":"브라우저에서 열려요"},{"value":"static_page","rationale":"간단한 안내 페이지면 충분해요"}]}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        let proposals = parsed.proposals.expect("proposals parsed");
        assert_eq!(proposals.kind, "form");
        assert_eq!(proposals.options.len(), 2);
        // The proposals JSON must not leak into the shown assistant message.
        let message = parsed.assistant_message.unwrap_or_default();
        assert!(message.contains("어떤 형태가 좋을까요?"));
        assert!(!message.contains("proposals"));
        assert!(!message.contains("web_app"));
        assert_eq!(parsed.parse_failure_kind, None);
    }

    // S-053 D1: the two structuring-failure kinds `parse_prd_turn_response`
    // must distinguish, plus the genuine-"none" path that must NOT be
    // misclassified as either.

    #[test]
    fn parse_turn_response_flags_no_json_when_raw_has_no_json_object() {
        let raw = "이 질문에 대해 조금 더 설명해 주시겠어요?";
        let parsed = parse_prd_turn_response(raw, "turn-1");
        assert!(parsed.patch.is_none());
        assert_eq!(parsed.parse_failure_kind, Some("no_json"));
    }

    #[test]
    fn parse_turn_response_flags_undecodable_json_when_neither_shape_matches() {
        // A single top-level JSON object: the "patch" key is present (so the
        // RawPrdTurnResponse deserialize doesn't just skip it as unknown) but
        // its value has the wrong shape (a string, not an operations object),
        // so it fails RawPrdTurnResponse; and there's no top-level
        // "operations" key, so it also fails the bare RawPrdPatch shape. The
        // nested "operations" substring makes it eligible for the fallback
        // candidate selection in `extract_prd_turn_json_candidate`.
        let raw = r#"{"assistantMessage":"제가 응답 구조를 잘못 만들었어요.","patch":{"operations":"oops"}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        assert!(parsed.patch.is_none());
        assert_eq!(parsed.parse_failure_kind, Some("undecodable_json"));
    }

    #[test]
    fn parse_turn_response_leaves_genuine_none_unflagged() {
        // A well-formed RawPrdTurnResponse with no `patch` key at all: the
        // model answered but proposed no change. This must NOT be flagged as
        // a parse failure.
        let raw = r#"{"assistantMessage":"이 부분은 다음에 더 알려주시겠어요?"}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        assert!(parsed.patch.is_none());
        assert_eq!(parsed.parse_failure_kind, None);
    }
}
