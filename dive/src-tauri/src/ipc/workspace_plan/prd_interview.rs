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
    // Wily P2 cleanup: persist the PROPOSED/APPLIED/REJECTED/UNSTRUCTURED patch
    // event(s), the live draft update, and the InterviewTurn row as ONE
    // transaction. These used to be separate writes on the raw connection — a
    // mid-sequence failure (e.g. the live-draft write succeeding but the
    // InterviewTurn insert failing) left the audit ledger inconsistent with
    // the draft: an EventLog row with no InterviewTurn to explain it, or a
    // draft mutation with no turn record at all.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current_draft = load_or_create_prd_draft(&tx, input.project_id, &input.draft_id)?;
    // Wily P2 cleanup: stamp PRD interview events with the project's session
    // instead of `None` — a NULL session_id makes a row permanently
    // unreachable by the session-scoped EventLog export
    // (`ExportEngine::export_session` selects `WHERE session_id = ?`).
    let interview_session_id =
        super::plan_lifecycle::latest_session_id_for_project(&tx, input.project_id);
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
            &tx,
            interview_session_id,
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
        persist_live_prd_draft(&tx, &applied.draft)?;

        if applied.validation_outcome == "applied" {
            dive_event_log::append_to_conn(
                &tx,
                interview_session_id,
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
            let held_for_student = applied.validation_outcome == "held_for_student";
            // S-072 review (P2): a hold is PER OP (Constitution VI / D-014-09
            // — holding the whole patch would stall the interview whenever a
            // student hand-edits one field), so a held turn can still have
            // landed the other ops. Make that partial apply auditable: emit
            // the applied event for what got in, then the held marker for
            // what did not. The frontend already receives
            // `applied_field_paths` on the held outcome (set above).
            if held_for_student && !applied.applied_field_paths.is_empty() {
                dive_event_log::append_to_conn(
                    &tx,
                    interview_session_id,
                    dive_event_log::PRD_PATCH_APPLIED_EVENT,
                    dive_event_log::prd_patch_applied_payload(
                        input.project_id,
                        project_spec_id_for_draft(&applied.draft),
                        applied.draft.draft_id.clone(),
                        turn_id.clone(),
                        patch.patch_id.clone(),
                        applied.applied_field_paths.clone(),
                        applied.criterion_ids_assigned.clone(),
                        applied.student_edited_fields_respected.clone(),
                    ),
                )
                .map_err(|e| e.to_string())?;
            }
            dive_event_log::append_to_conn(
                &tx,
                interview_session_id,
                dive_event_log::PRD_PATCH_REJECTED_EVENT,
                dive_event_log::prd_patch_rejected_payload(
                    input.project_id,
                    project_spec_id_for_draft(&applied.draft),
                    applied.draft.draft_id,
                    turn_id.clone(),
                    patch.patch_id,
                    applied.rejected_reasons,
                    held_for_student,
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
                &tx,
                interview_session_id,
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
        &tx,
        &NewInterviewTurn {
            draft_id: output.live_draft.draft_id.clone(),
            turn_id,
            student_answer: input.answer,
            outcome: prd_validation_outcome_enum(&output.validation_outcome),
            parse_failure_kind: turn_parse_failure_kind,
        },
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

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
        "The patch may only use these operation names: set_goal, set_intent_summary, append_scope, append_non_goal, append_constraint, append_acceptance_criterion, revise_acceptance_criterion_text, revise_scope, revise_non_goal, revise_constraint, remove_scope, remove_non_goal, remove_constraint, retire_acceptance_criterion.",
        "Each patch operation object MUST use the key \"op\" for the operation name; do not use \"operation\".",
        "For append_acceptance_criterion and revise_acceptance_criterion_text, put the criterion wording in \"text\".",
        // S-072 (014 theme 2): in-place edits. Without these the model's only
        // way to "change" an item was to append a corrected duplicate under
        // the old one (QA: "수정하면 아래에 추가로 쌓이고 내용이 수정 안 됨").
        "For revise_scope / revise_non_goal / revise_constraint put the CURRENT item text in \"target\" (copy it exactly from the draft JSON) and the new wording in \"value\". For remove_scope / remove_non_goal / remove_constraint put the current item text in \"target\". For retire_acceptance_criterion put the criterion's id in \"criterionId\".",
        "When the student asks to change, correct, or drop something that is already in the draft, edit it in place with those operations — never append a corrected duplicate under the old item.",
        "Acceptance criteria with status \"retired\" in the draft JSON are already dropped — ignore them, never revise or retire them again, and never treat them as active.",
        "Do not invent IDs for new criteria; DIVE assigns AC IDs.",
        "Never put the architecture (tech stack) in the patch — the student decides it by clicking a card or typing, not you.",
        // S-075 (014 theme 4, D-014-16): the architecture decision is one stack
        // confirmation. No form taxonomy — the rationale itself says, in plain
        // words, what the finished thing is (Constitution VII).
        "When the suggested next focus is propose_architecture_stack, ALSO return \"proposals\":{\"kind\":\"stack\",\"options\":[{\"value\":\"<concise stack, e.g. React + Vite>\",\"rationale\":\"<one plain line: what the finished thing is (a browser app, a command-line tool, a bot…) and why this stack>\"}]} with up to 2 options, and still ask the student to confirm or change it in assistantMessage. Omit \"proposals\" on any other focus.",
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
    // S-047: optional tech-stack recommendation surface. Never a patch — the
    // architecture is applied only by the student's card click or typing.
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
    /// Shape-validate the AI's raw proposals: keep only the `stack` kind (S-075
    /// — a legacy `form` proposal is dropped), drop options with an empty value,
    /// trim wording, and cap at two options. Returns `None` when nothing usable
    /// remains. The current-focus gate is applied separately by the caller.
    fn into_sanitized(self) -> Option<ArchitectureProposals> {
        if self.kind.as_deref().map(str::trim) != Some("stack") {
            return None;
        }
        let options: Vec<ArchitectureProposalOption> = self
            .options
            .into_iter()
            .filter_map(|option| {
                let value = option.value?.trim().to_string();
                if value.is_empty() {
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
            kind: "stack".to_string(),
            options,
        })
    }
}

/// `Some("stack")` when the next confirm gap is the tech stack, else `None`.
/// Used to gate AI proposals to the deterministic focus the model was asked to
/// answer, so stale/off-focus cards never surface.
fn expected_architecture_proposal_kind(spec: &ProjectSpecDraft) -> Option<&'static str> {
    match confirmable_draft_gaps(spec).first() {
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
    // S-072: tolerant parse of the current-item address for the revise_* /
    // remove_* list ops — models paraphrase the key name, so accept the
    // obvious synonyms and normalize to `target`.
    #[serde(alias = "old", alias = "oldText", alias = "old_text", alias = "from")]
    target: Option<String>,
    // S-072 review: the NEW wording of a revise, when the model names it as
    // the counterpart of `old`/`from` instead of `value`. Folded into `value`
    // below. (serde rejects a payload carrying two spellings of one field —
    // that surfaces as `undecodable_json`, never a crash.)
    #[serde(alias = "new", alias = "newText", alias = "new_text", alias = "to")]
    new_value: Option<String>,
}

impl RawPrdPatchOperation {
    fn into_prd_operation(self) -> PrdPatchOperation {
        let RawPrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
            target,
            new_value,
        } = self;
        // S-072 review: canonicalize the op-name paraphrases models reach for.
        let op = match op.as_str() {
            "remove_acceptance_criterion" | "delete_acceptance_criterion" => {
                "retire_acceptance_criterion".to_string()
            }
            "delete_scope" => "remove_scope".to_string(),
            "delete_non_goal" => "remove_non_goal".to_string(),
            "delete_constraint" => "remove_constraint".to_string(),
            _ => op,
        };
        let value = value.or(new_value);
        let value = match op.as_str() {
            "set_goal" | "set_intent_summary" | "append_scope" | "append_non_goal"
            | "append_constraint" | "revise_scope" | "revise_non_goal" | "revise_constraint" => {
                value.or_else(|| text.clone())
            }
            _ => value,
        };
        let text = match op.as_str() {
            "append_acceptance_criterion" | "revise_acceptance_criterion_text" => {
                text.or_else(|| value.clone())
            }
            _ => text,
        };
        // A remove only addresses an item: whatever text the model sent IS the
        // target, and no other text field survives (so the secret-gate
        // exemption on a remove target cannot be sidestepped via `value`).
        let (value, text, target) = match op.as_str() {
            "remove_scope" | "remove_non_goal" | "remove_constraint" => {
                (None, None, target.or(value).or(text))
            }
            _ => (value, text, target),
        };
        // S-047: the AI interview patch never carries an architecture decision — the
        // architecture is set only through the student's draft-save path (no AI
        // auto-finalize), so there is no `set_architecture` patch op to build here.
        PrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
            target,
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
        ArchitectureDecision, ArchitectureDecisionSource, ProjectSpecDraft, ProjectSpecStatus,
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

        // S-047 → S-075: after the 5 confirmable fields, the interview asks for
        // the tech stack — a draft without one is NOT yet ready to confirm.
        assert!(prd_interview_next_focus(&draft.spec).starts_with("propose_architecture_stack"));
        assert!(missing_confirmable_prd_fields(&draft.spec).contains(&"tech stack"));

        // A blank stack is not a confirmed stack either.
        draft.spec.architecture = Some(ArchitectureDecision {
            stack: Some("   ".into()),
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert!(prd_interview_next_focus(&draft.spec).starts_with("propose_architecture_stack"));

        // With the stack confirmed, the draft is ready to confirm.
        draft.spec.architecture = Some(ArchitectureDecision {
            stack: Some("React + Vite + TypeScript".into()),
            rationale: Some("A browser app the student can open anywhere".into()),
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
    /// on the tech-stack focus (S-075: the one architecture focus).
    fn draft_on_stack_focus() -> LiveProjectSpecDraftRow {
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
    fn expected_proposal_kind_is_stack_only_on_the_stack_focus() {
        // No architecture yet -> the stack focus.
        let mut draft = draft_on_stack_focus();
        assert_eq!(
            expected_architecture_proposal_kind(&draft.spec),
            Some("stack")
        );

        // A decision row with a blank stack is still on the stack focus.
        draft.spec.architecture = Some(ArchitectureDecision {
            stack: Some("  ".into()),
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert_eq!(
            expected_architecture_proposal_kind(&draft.spec),
            Some("stack")
        );

        // Stack confirmed -> no architecture focus, so no cards.
        draft.spec.architecture = Some(ArchitectureDecision {
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

    /// S-075 (014 theme 4, D-014-16): exactly one architecture gap — the tech
    /// stack — whose focus asks for ≤2 stacks with a plain "what the finished
    /// thing is" line and tells the model never to decide for the student.
    #[test]
    fn confirmable_gaps_report_one_stack_gap_only() {
        let mut draft = draft_on_stack_focus();

        let gaps = confirmable_draft_gaps(&draft.spec);
        assert_eq!(gaps.len(), 1);
        assert_eq!(gaps[0].label, "tech stack");
        assert!(gaps[0].focus.starts_with("propose_architecture_stack:"));
        assert!(gaps[0].focus.contains("what the finished thing is"));
        assert!(gaps[0].focus.contains("never decide for them"));
        assert!(!gaps[0].focus.contains("form"));

        draft.spec.architecture = Some(ArchitectureDecision {
            stack: Some("Python + discord.py".into()),
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        });
        assert!(confirmable_draft_gaps(&draft.spec).is_empty());
    }

    #[test]
    fn system_prompt_asks_for_stack_proposals_only() {
        let prompt = build_prd_interview_system_prompt();
        assert!(prompt.contains(
            "Never put the architecture (tech stack) in the patch — the student decides it by clicking a card or typing, not you."
        ));
        assert!(prompt.contains("When the suggested next focus is propose_architecture_stack, ALSO return \"proposals\":{\"kind\":\"stack\""));
        assert!(prompt.contains("what the finished thing is (a browser app, a command-line tool, a bot…) and why this stack"));
        assert!(prompt.contains("Omit \"proposals\" on any other focus."));
        assert!(!prompt.contains("propose_architecture_form"));
        assert!(!prompt.contains("\"kind\":\"form\""));
        assert!(!prompt.contains("web_app"));
        assert!(!prompt.contains("combine several forms"));
    }

    #[test]
    fn sanitize_drops_form_kind_proposals() {
        // S-075: the form taxonomy is gone — a stale model still answering with
        // `kind: "form"` produces no cards at all.
        let raw = RawPrdProposals {
            kind: Some("form".into()),
            options: vec![RawPrdProposalOption {
                value: Some("web_app".into()),
                rationale: Some("Opens in a browser".into()),
            }],
        };
        assert!(raw.into_sanitized().is_none());
    }

    #[test]
    fn sanitize_stack_proposals_trim_and_cap_two() {
        let raw = RawPrdProposals {
            kind: Some(" stack ".into()),
            options: vec![
                RawPrdProposalOption {
                    value: Some("  React + Vite ".into()),
                    rationale: Some(" A browser app; easy to share ".into()),
                },
                RawPrdProposalOption {
                    value: Some("Python + Flask".into()),
                    rationale: None,
                },
                RawPrdProposalOption {
                    value: Some("Node script".into()),
                    rationale: Some("would be third".into()),
                },
            ],
        };
        let sanitized = raw.into_sanitized().expect("stack options remain");
        assert_eq!(sanitized.kind, "stack");
        assert_eq!(sanitized.options.len(), 2);
        assert_eq!(sanitized.options[0].value, "React + Vite");
        assert_eq!(
            sanitized.options[0].rationale,
            "A browser app; easy to share"
        );
        assert_eq!(sanitized.options[1].value, "Python + Flask");
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
            kind: Some("stack".into()),
            options: vec![
                RawPrdProposalOption {
                    value: Some("   ".into()),
                    rationale: None,
                },
                RawPrdProposalOption {
                    value: None,
                    rationale: Some("no value".into()),
                },
            ],
        }
        .into_sanitized()
        .is_none());
    }

    #[test]
    fn parse_turn_response_extracts_proposals_alongside_message() {
        let raw = r#"{"assistantMessage":"이렇게 만들 계획이에요 — 괜찮을까요?","proposals":{"kind":"stack","options":[{"value":"React + Vite","rationale":"브라우저에서 여는 앱 — 설치 없이 바로 공유"},{"value":"Python + Flask","rationale":"간단한 서버 하나로 충분한 웹앱"}]}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        let proposals = parsed.proposals.expect("proposals parsed");
        assert_eq!(proposals.kind, "stack");
        assert_eq!(proposals.options.len(), 2);
        // The proposals JSON must not leak into the shown assistant message.
        let message = parsed.assistant_message.unwrap_or_default();
        assert!(message.contains("이렇게 만들 계획이에요"));
        assert!(!message.contains("proposals"));
        assert!(!message.contains("React + Vite"));
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

    // S-072 (014 theme 2): `target` is the current-item address for the
    // revise_* / remove_* list ops. It must survive the raw parse verbatim, and
    // `text` folds into `value` for revise_* exactly like the append_* ops.
    #[test]
    fn parse_turn_response_carries_target_for_revise_scope() {
        let raw = r#"{"assistantMessage":"바꿨어요.","patch":{"operations":[{"op":"revise_scope","target":"old","value":"new"}]}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        let patch = parsed.patch.expect("patch parsed");
        assert_eq!(patch.operations.len(), 1);
        let operation = &patch.operations[0];
        assert_eq!(operation.op, "revise_scope");
        assert_eq!(operation.target.as_deref(), Some("old"));
        assert_eq!(operation.value.as_deref(), Some("new"));
        assert_eq!(parsed.parse_failure_kind, None);
    }

    #[test]
    fn parse_turn_response_accepts_target_aliases_and_folds_text_into_value() {
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[
            {"op":"revise_non_goal","oldText":"old wording","text":"new wording"},
            {"op":"remove_constraint","from":"drop me"},
            {"op":"retire_acceptance_criterion","criterion_id":"AC-002"}
        ]}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        let patch = parsed.patch.expect("patch parsed");
        assert_eq!(patch.operations.len(), 3);
        assert_eq!(patch.operations[0].op, "revise_non_goal");
        assert_eq!(patch.operations[0].target.as_deref(), Some("old wording"));
        assert_eq!(patch.operations[0].value.as_deref(), Some("new wording"));
        assert_eq!(patch.operations[1].op, "remove_constraint");
        assert_eq!(patch.operations[1].target.as_deref(), Some("drop me"));
        assert_eq!(patch.operations[1].value, None);
        assert_eq!(patch.operations[2].op, "retire_acceptance_criterion");
        assert_eq!(patch.operations[2].criterion_id.as_deref(), Some("AC-002"));
        assert_eq!(patch.operations[2].target, None);
    }

    #[test]
    fn interview_system_prompt_lists_in_place_edit_ops_and_forbids_duplicates() {
        let prompt = build_prd_interview_system_prompt();
        for op in [
            "revise_scope",
            "revise_non_goal",
            "revise_constraint",
            "remove_scope",
            "remove_non_goal",
            "remove_constraint",
            "retire_acceptance_criterion",
        ] {
            assert!(prompt.contains(op), "prompt must list {op}");
        }
        assert!(prompt.contains("never append a corrected duplicate under the old item"));
        assert!(prompt.contains("copy it exactly from the draft JSON"));
    }

    // S-072 review (P1): retired criteria are already dropped; the model must
    // not revise/retire them again or count them as active.
    #[test]
    fn interview_system_prompt_tells_model_to_ignore_retired_criteria() {
        let prompt = build_prd_interview_system_prompt();
        assert!(prompt.contains(
            "Acceptance criteria with status \"retired\" in the draft JSON are already dropped — ignore them, never revise or retire them again, and never treat them as active."
        ));
    }

    // S-072 review (P2): op-name and field-name paraphrases models reach for.

    #[test]
    fn parse_turn_response_maps_delete_and_remove_criterion_aliases_to_canonical_ops() {
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[
            {"op":"delete_scope","target":"a"},
            {"op":"delete_non_goal","target":"b"},
            {"op":"delete_constraint","target":"c"},
            {"op":"remove_acceptance_criterion","criterionId":"AC-001"},
            {"op":"delete_acceptance_criterion","criterionId":"AC-002"}
        ]}}"#;
        let patch = parse_prd_turn_response(raw, "turn-1")
            .patch
            .expect("patch parsed");
        let ops: Vec<&str> = patch
            .operations
            .iter()
            .map(|operation| operation.op.as_str())
            .collect();
        assert_eq!(
            ops,
            vec![
                "remove_scope",
                "remove_non_goal",
                "remove_constraint",
                "retire_acceptance_criterion",
                "retire_acceptance_criterion",
            ]
        );
        assert_eq!(patch.operations[0].target.as_deref(), Some("a"));
        assert_eq!(patch.operations[3].criterion_id.as_deref(), Some("AC-001"));
        assert_eq!(patch.operations[4].criterion_id.as_deref(), Some("AC-002"));
    }

    #[test]
    fn parse_turn_response_folds_value_or_text_into_target_for_remove_ops() {
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[
            {"op":"remove_scope","value":"from value"},
            {"op":"remove_non_goal","text":"from text"},
            {"op":"delete_constraint","target":"explicit","value":"ignored"}
        ]}}"#;
        let patch = parse_prd_turn_response(raw, "turn-1")
            .patch
            .expect("patch parsed");
        assert_eq!(patch.operations[0].target.as_deref(), Some("from value"));
        assert_eq!(patch.operations[0].value, None);
        assert_eq!(patch.operations[0].text, None);
        assert_eq!(patch.operations[1].target.as_deref(), Some("from text"));
        assert_eq!(patch.operations[1].text, None);
        // An explicit target wins; the stray value is dropped, not kept.
        assert_eq!(patch.operations[2].op, "remove_constraint");
        assert_eq!(patch.operations[2].target.as_deref(), Some("explicit"));
        assert_eq!(patch.operations[2].value, None);
    }

    #[test]
    fn parse_turn_response_accepts_new_wording_aliases_for_value() {
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[
            {"op":"revise_scope","old":"a","new":"a1"},
            {"op":"revise_non_goal","from":"b","to":"b1"},
            {"op":"revise_constraint","oldText":"c","newText":"c1"},
            {"op":"revise_constraint","old_text":"d","new_text":"d1"},
            {"op":"revise_scope","target":"e","value":"explicit","new":"ignored"}
        ]}}"#;
        let patch = parse_prd_turn_response(raw, "turn-1")
            .patch
            .expect("patch parsed");
        let pairs: Vec<(Option<&str>, Option<&str>)> = patch
            .operations
            .iter()
            .map(|operation| (operation.target.as_deref(), operation.value.as_deref()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                (Some("a"), Some("a1")),
                (Some("b"), Some("b1")),
                (Some("c"), Some("c1")),
                (Some("d"), Some("d1")),
                // `value` wins over the alias when both are present.
                (Some("e"), Some("explicit")),
            ]
        );
    }

    #[test]
    fn parse_turn_response_keeps_text_for_retire_without_criterion_id() {
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[
            {"op":"retire_acceptance_criterion","text":"Exports a CSV"},
            {"op":"remove_acceptance_criterion","target":"AC-002"}
        ]}}"#;
        let patch = parse_prd_turn_response(raw, "turn-1")
            .patch
            .expect("patch parsed");
        assert_eq!(patch.operations[0].criterion_id, None);
        assert_eq!(patch.operations[0].text.as_deref(), Some("Exports a CSV"));
        assert_eq!(patch.operations[1].op, "retire_acceptance_criterion");
        assert_eq!(patch.operations[1].target.as_deref(), Some("AC-002"));
    }

    #[test]
    fn parse_turn_response_treats_two_spellings_of_one_field_as_undecodable_not_a_crash() {
        // serde refuses `target` + `old` on one object; that must surface as
        // the existing undecodable_json outcome.
        let raw = r#"{"assistantMessage":"ok","patch":{"operations":[{"op":"revise_scope","target":"a","old":"a","value":"b"}]}}"#;
        let parsed = parse_prd_turn_response(raw, "turn-1");
        assert!(parsed.patch.is_none());
        assert_eq!(parsed.parse_failure_kind, Some("undecodable_json"));
    }
}

#[cfg(test)]
mod interview_turn_transaction_tests {
    use super::*;
    use crate::db::dao::project as project_dao;
    use crate::db::models::NewProject;
    use crate::ipc::{ProviderKind, ProviderRuntime};
    use crate::providers::{LlmProvider, ModelInfo, ProviderError};
    use futures::stream::BoxStream;
    use std::sync::{Arc, Mutex};

    /// Deletes the project mid-`chat()` call — the same seam
    /// `ConcurrentDraftEditProvider` (in `ipc::tests`) uses to simulate a
    /// race — then returns a scripted `set_goal` patch response. By the time
    /// the impl reaches `persist_live_prd_draft`, the project no longer
    /// exists, so the `LiveProjectSpecDraft.project_id` foreign key rejects
    /// the write: a deterministic, real mid-sequence DB failure, not a
    /// hand-rolled stand-in for one.
    struct DeleteProjectMidCallProvider {
        db: Arc<Mutex<crate::db::Database>>,
        project_id: i64,
    }

    #[async_trait::async_trait]
    impl LlmProvider for DeleteProjectMidCallProvider {
        fn id(&self) -> &str {
            "delete-project-mid-call-mock"
        }

        fn list_models(&self) -> Vec<ModelInfo> {
            Vec::new()
        }

        async fn chat(
            &self,
            _req: ChatRequest,
        ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
            {
                let db = self.db.lock().unwrap();
                project_dao::delete(db.conn(), self.project_id).unwrap();
            }
            let events = vec![
                ChatEvent::TextDelta(
                    r#"{"assistantMessage":"목표를 반영했어요.","patch":{"operations":[{"op":"set_goal","value":"학생들이 숙제를 관리하는 앱"}],"rationale":"목표를 명확히 했어요"}}"#
                        .into(),
                ),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ];
            Ok(futures::stream::iter(events).boxed())
        }

        async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    /// Regression for the P2 finding: the PRD-interview turn used to persist
    /// the PRD_PATCH_PROPOSED event, the live draft, and the InterviewTurn row
    /// as separate un-transactioned writes — a mid-sequence failure could
    /// leave the EventLog row committed with no corresponding draft update or
    /// InterviewTurn record. The fix wraps all three in one transaction, so a
    /// failure partway through rolls back everything written so far in that
    /// turn, not just the statement that failed.
    #[tokio::test]
    async fn mid_sequence_failure_rolls_back_the_earlier_event_write_too() {
        let state = AppState::dev_mock();
        let project_id = {
            let db = state.db.lock().unwrap();
            project_dao::insert(
                db.conn(),
                &NewProject {
                    name: "p".into(),
                    path: "/tmp/p".into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap()
        };
        let draft_id = format!("prd-draft-{project_id}");

        state
            .swap_runtime(ProviderRuntime::new(
                Some(1),
                ProviderKind::OpenAi,
                crate::providers::default_model_for_kind("openai").to_string(),
                Arc::new(DeleteProjectMidCallProvider {
                    db: state.db.clone(),
                    project_id,
                }),
            ))
            .unwrap();

        let result = workspace_prd_interview_turn_impl(
            &state,
            PrdInterviewTurnInput {
                project_id,
                draft_id,
                answer: "학생들이 숙제를 관리하는 앱을 만들고 싶어요.".into(),
                conversation: Vec::new(),
                provider: "openai".into(),
                model: crate::providers::default_model_for_kind("openai").to_string(),
            },
        )
        .await;

        assert!(
            result.is_err(),
            "the live-draft write must fail once its project is gone mid-call"
        );

        let db = state.db.lock().unwrap();
        let event_count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM EventLog WHERE type = ?1",
                [dive_event_log::PRD_PATCH_PROPOSED_EVENT],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            event_count, 0,
            "the PRD_PATCH_PROPOSED event, written earlier in the same \
             transaction, must be rolled back along with the later failed write"
        );
        let turn_count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM InterviewTurn", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            turn_count, 0,
            "the InterviewTurn row must not be persisted when the turn fails"
        );
    }
}
