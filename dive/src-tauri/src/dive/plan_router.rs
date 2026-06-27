//! Text-mode router for deciding whether a user chat should amend a plan.
//!
//! The router intentionally avoids tool calls. It asks the configured provider
//! for one compact `ROUTE ...` line and parses that line into a draft decision
//! that the IPC layer can present for user confirmation.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use regex::Regex;

use crate::db::models::StepKind;
use crate::providers::{ChatEvent, ChatRequest, FinishReason, LlmProvider, Message, ToolChoice};

const ROUTE_CANCELLED_MESSAGE: &str = "route chat cancelled";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRouterContext {
    pub goal: String,
    pub intent_summary: Option<String>,
    pub scope: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub steps: Vec<PlanRouterStepContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRouterStepContext {
    pub step_id: String,
    pub title: String,
    pub status: String,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanRouterDecision {
    AddStep {
        draft: Box<RouterStepDraft>,
        reason: String,
    },
    Chat {
        reason: String,
    },
    /// S-033: ask one criterion-linked question before drafting an ambiguous
    /// add, instead of fabricating a step. Non-mutating.
    Clarify {
        question: String,
        candidate_intent: String,
        suggested_criterion_ids: Vec<String>,
        reason: String,
    },
    /// S-033: propose retiring an existing step. `target_step_id` is validated
    /// against the live plan at the IPC layer (degrades to Skip if unknown).
    Remove {
        target_step_id: String,
        reason: String,
    },
    /// S-033: propose replacing an existing step with a new draft (atomic
    /// retire + add at apply time).
    Supersede {
        target_step_id: String,
        replacement: Box<RouterStepDraft>,
        reason: String,
    },
    /// S-033: a genuinely multi-part ask fanned into N dependency-ordered steps.
    /// Each entry pairs a draft with its `depends_on` sibling indices (0-based,
    /// into this batch). In-range / non-self deps are validated at parse; cycle
    /// and envelope checks are deferred to the apply IPC.
    MultiStep {
        steps: Vec<(RouterStepDraft, Vec<usize>)>,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterStepDraft {
    pub title: String,
    pub summary: String,
    pub instruction_seed: String,
    pub expected_files: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub step_kind: Option<StepKind>,
    pub verification_command: Option<String>,
    pub verification_type: Option<String>,
    pub dependencies: Vec<String>,
    pub parallel_group: Option<i64>,
}

pub async fn decide(
    provider: &dyn LlmProvider,
    model: String,
    prompt: String,
    ctx: PlanRouterContext,
) -> Result<PlanRouterDecision, String> {
    decide_cancelable(provider, model, prompt, ctx, None).await
}

pub async fn decide_cancelable(
    provider: &dyn LlmProvider,
    model: String,
    prompt: String,
    ctx: PlanRouterContext,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<PlanRouterDecision, String> {
    let req = ChatRequest {
        model,
        messages: vec![
            Message::System {
                content: build_system_prompt(),
            },
            Message::User {
                content: build_user_prompt(&prompt, &ctx),
            },
        ],
        tools: None,
        tool_choice: Some(ToolChoice::None),
        temperature: Some(0.0),
        max_tokens: Some(700),
        stream: true,
    };
    check_route_cancel(cancel.as_ref())?;
    let mut stream = if let Some(cancel) = cancel.clone() {
        tokio::select! {
            result = provider.chat(req) => result.map_err(|e| e.to_string())?,
            _ = wait_for_route_cancel(cancel) => return Err(ROUTE_CANCELLED_MESSAGE.into()),
        }
    } else {
        provider.chat(req).await.map_err(|e| e.to_string())?
    };
    let mut text = String::new();
    let mut finish_reason = FinishReason::Stop;
    loop {
        check_route_cancel(cancel.as_ref())?;
        let event = if let Some(cancel) = cancel.clone() {
            tokio::select! {
                event = stream.next() => event,
                _ = wait_for_route_cancel(cancel) => return Err(ROUTE_CANCELLED_MESSAGE.into()),
            }
        } else {
            stream.next().await
        };
        let Some(event) = event else {
            break;
        };
        match event {
            ChatEvent::TextDelta(delta) => text.push_str(&delta),
            ChatEvent::Done { finish_reason: fr } => {
                finish_reason = fr;
                break;
            }
            ChatEvent::Error(err) => return Err(err),
            ChatEvent::Usage { .. }
            | ChatEvent::ReasoningDelta(_)
            | ChatEvent::ToolCallStart { .. }
            | ChatEvent::ToolCallDelta { .. }
            | ChatEvent::ToolCallEnd { .. } => {}
        }
    }
    if finish_reason == FinishReason::Length {
        return Err("router response was truncated".into());
    }
    check_route_cancel(cancel.as_ref())?;
    parse_route_decision(&text)
}

fn check_route_cancel(cancel: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if cancel
        .map(|token| token.load(Ordering::SeqCst))
        .unwrap_or(false)
    {
        Err(ROUTE_CANCELLED_MESSAGE.into())
    } else {
        Ok(())
    }
}

async fn wait_for_route_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

fn build_system_prompt() -> String {
    "You are DIVE's plan router. Decide how the user's new chat message relates \
     to the already-approved plan: add a step, clarify an ambiguous add, remove \
     a step, replace (supersede) a step, fan a multi-part ask into several \
     dependency-ordered steps (multi_step), or stay normal chat.\n\
     Return exactly one line. No Markdown. No explanation outside the line.\n\
     Use ROUTE chat for questions, status checks, discussion, or anything that \
     does not change the plan. If the user asks to run, continue, inspect, \
     verify, or repeat work already covered by an existing listed step, use \
     ROUTE chat.\n\
     Use ROUTE add_step only when the user asks for a new concrete task that \
     belongs in the current approved plan.\n\
     Use ROUTE clarify when the user wants new work but the target, criterion, \
     or scope is too ambiguous to draft without inventing details: ask one \
     short, criterion-linked question instead of fabricating a step.\n\
     Use ROUTE remove when the user asks to drop, cancel, or delete an existing \
     listed step that is no longer wanted.\n\
     Use ROUTE supersede when the user asks to replace, redo, or rework an \
     existing listed step with materially different work (not merely re-run it); \
     provide the full replacement step.\n\
     Use ROUTE multi_step ONLY for a genuinely multi-part ask that should fan \
     into several new steps — never cram multiple tasks into one add_step, and \
     never use it for a single step. Each step lists depends_on: the 0-based \
     positions of EARLIER steps in this same batch it depends on.\n\
     For remove and supersede, target_step_id MUST be one of the step ids in the \
     Steps list — never invent an id. If no listed step matches, use ROUTE chat.\n\
     New or replacement steps must fit DIVE's execution envelope: one supervised \
     turn, small file-focused scope, no shell scripts, and verification_type \
     must be one of run, preview, manual, or test. Use preview or manual with \
     an empty verification_command for static front-end or no-runnable-command \
     steps; use run or test only with a real no-shell command with explicit args \
     and a 60 second budget. Set step_kind to one of feature, refactor, rename, \
     comment, or debug based on the proposed step itself. Use refactor/rename \
     only for behavior-preserving move/restructure/name changes; use debug for \
     diagnose-then-fix work.\n\
     Output formats:\n\
     ROUTE chat reason=\"short reason\"\n\
     ROUTE add_step title=\"...\" summary=\"...\" instruction_seed=\"...\" \
     expected_files=[\"path or glob\"] acceptance_criteria=[\"observable result\"] \
     step_kind=\"feature|refactor|rename|comment|debug\" \
     verification_type=\"run|preview|manual|test\" verification_command=\"command or empty\" \
     dependencies=[\"step-001\"] parallel_group=null reason=\"short reason\"\n\
     ROUTE clarify question=\"one criterion-linked question\" \
     candidate_intent=\"what you think they want\" \
     suggested_criterion_ids=[\"ac-1\"] reason=\"short reason\"\n\
     ROUTE remove target_step_id=\"step-001\" reason=\"short reason\"\n\
     ROUTE supersede target_step_id=\"step-001\" title=\"...\" summary=\"...\" \
     instruction_seed=\"...\" expected_files=[\"path or glob\"] \
     acceptance_criteria=[\"observable result\"] step_kind=\"feature|refactor|rename|comment|debug\" \
     verification_type=\"run|preview|manual|test\" verification_command=\"command or empty\" \
     dependencies=[\"step-001\"] parallel_group=null reason=\"short reason\"\n\
     ROUTE multi_step {\"reason\":\"short reason\",\"steps\":[{\"title\":\"...\",\
     \"summary\":\"...\",\"instruction_seed\":\"...\",\"expected_files\":[\"path\"],\
     \"acceptance_criteria\":[\"observable result\"],\"step_kind\":\"feature\",\
     \"verification_type\":\
     \"run|preview|manual|test\",\"verification_command\":\"command or empty\",\
     \"dependencies\":[\"step-001\"],\"parallel_group\":null,\"depends_on\":[0]}]}\n\
     The multi_step payload is one JSON object on the SAME single line (no \
     Markdown, no newline inside it). depends_on lists 0-based indices of earlier \
     steps in this batch; dependencies still lists only EXISTING plan step ids.\n\
     Existing step ids are the only allowed dependency values. Use null for \
     parallel_group unless a numeric existing group is clearly appropriate. \
     For clarify, set suggested_criterion_ids to the acceptance-criterion ids the \
     question relates to when identifiable, otherwise []."
        .to_string()
}

fn build_user_prompt(prompt: &str, ctx: &PlanRouterContext) -> String {
    let steps = ctx
        .steps
        .iter()
        .map(|step| {
            format!(
                "- {} | {} | status={} | dependencies={}",
                step.step_id,
                step.title,
                step.status,
                serde_json::to_string(&step.dependencies).unwrap_or_else(|_| "[]".into())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Current approved plan:\n\
         Goal: {goal}\n\
         Intent summary: {intent_summary}\n\
         Scope: {scope}\n\
         Acceptance criteria: {acceptance}\n\
         Steps:\n{steps}\n\n\
         User chat message:\n{prompt}",
        goal = ctx.goal,
        intent_summary = ctx.intent_summary.as_deref().unwrap_or(""),
        scope = serde_json::to_string(&ctx.scope).unwrap_or_else(|_| "[]".into()),
        acceptance =
            serde_json::to_string(&ctx.acceptance_criteria).unwrap_or_else(|_| "[]".into()),
        prompt = prompt,
    )
}

fn parse_route_decision(text: &str) -> Result<PlanRouterDecision, String> {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("ROUTE "))
        .ok_or_else(|| "router response did not contain a ROUTE line".to_string())?;
    let route_re =
        Regex::new(r"^ROUTE\s+(add_step|chat|clarify|remove|supersede|multi_step)\b(?P<rest>.*)$")
            .map_err(|e| e.to_string())?;
    let caps = route_re
        .captures(line)
        .ok_or_else(|| "router response used an invalid ROUTE format".to_string())?;
    let action = caps
        .get(1)
        .map(|m| m.as_str())
        .ok_or_else(|| "router response omitted an action".to_string())?;
    let rest = caps.name("rest").map(|m| m.as_str()).unwrap_or("");
    match action {
        "chat" => Ok(PlanRouterDecision::Chat {
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "normal chat".into()),
        }),
        "add_step" => Ok(PlanRouterDecision::AddStep {
            draft: Box::new(parse_router_step_draft(rest)?),
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "new plan work".into()),
        }),
        "clarify" => Ok(PlanRouterDecision::Clarify {
            question: required_string(rest, "question")?,
            candidate_intent: field_string(rest, "candidate_intent")?.unwrap_or_default(),
            suggested_criterion_ids: field_array(rest, "suggested_criterion_ids")?
                .unwrap_or_default(),
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "needs clarification".into()),
        }),
        "remove" => Ok(PlanRouterDecision::Remove {
            target_step_id: required_string(rest, "target_step_id")?,
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "remove step".into()),
        }),
        "supersede" => Ok(PlanRouterDecision::Supersede {
            target_step_id: required_string(rest, "target_step_id")?,
            replacement: Box::new(parse_router_step_draft(rest)?),
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "replace step".into()),
        }),
        "multi_step" => parse_multi_step(rest),
        _ => Err(format!("unsupported route action: {action}")),
    }
}

/// S-033: deserialization target for the `ROUTE multi_step {JSON}` payload. The
/// flat `field_string`/`field_array` helpers can only read the first occurrence
/// of a key (and `field_array` cannot hold a nested array), so a per-step batch
/// is carried as one single-line JSON object parsed in one shot instead. Keys
/// mirror the flat grammar (snake_case); `depends_on` references sibling steps
/// by 0-based position within this batch.
#[derive(serde::Deserialize)]
struct MultiStepRest {
    #[serde(default)]
    reason: Option<String>,
    steps: Vec<RouterMultiStepItem>,
}

#[derive(serde::Deserialize)]
struct RouterMultiStepItem {
    title: String,
    summary: String,
    instruction_seed: String,
    #[serde(default)]
    expected_files: Vec<String>,
    #[serde(default)]
    acceptance_criteria: Vec<String>,
    #[serde(default)]
    step_kind: Option<StepKind>,
    #[serde(default)]
    verification_command: Option<String>,
    #[serde(default)]
    verification_type: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    parallel_group: Option<i64>,
    #[serde(default)]
    depends_on: Vec<usize>,
}

impl RouterMultiStepItem {
    /// Convert into a `RouterStepDraft` (matching `parse_router_step_draft`
    /// semantics — empty verification fields normalize to `None`) plus the
    /// step's sibling-index dependencies.
    fn into_draft_and_deps(self) -> (RouterStepDraft, Vec<usize>) {
        let draft = RouterStepDraft {
            title: self.title,
            summary: self.summary,
            instruction_seed: self.instruction_seed,
            expected_files: self.expected_files,
            acceptance_criteria: self.acceptance_criteria,
            step_kind: self.step_kind,
            verification_command: empty_to_none(self.verification_command),
            verification_type: empty_to_none(self.verification_type),
            dependencies: self.dependencies,
            parallel_group: self.parallel_group,
        };
        (draft, self.depends_on)
    }
}

/// S-033: parse a `multi_step` batch. Validates non-empty steps and that every
/// `depends_on` index is in-range and not self-referential — an early,
/// router-level guard mirroring the apply IPC. Cycle detection and the
/// MAX_PLAN_STEPS envelope are intentionally NOT checked here; they are owned by
/// `workspace_plan_append_steps` at apply time, so a cyclic/oversized batch
/// still parses as a valid (propose-only) MultiStep and is rejected on apply.
fn parse_multi_step(rest: &str) -> Result<PlanRouterDecision, String> {
    let parsed = serde_json::from_str::<MultiStepRest>(rest.trim())
        .map_err(|e| format!("router response malformed multi_step: {e}"))?;
    if parsed.steps.is_empty() {
        return Err("router response multi_step had no steps".into());
    }
    let count = parsed.steps.len();
    let mut steps = Vec::with_capacity(count);
    for (idx, item) in parsed.steps.into_iter().enumerate() {
        for &dep in &item.depends_on {
            if dep >= count {
                return Err(format!(
                    "multi_step step {idx} depends_on out-of-range index {dep}"
                ));
            }
            if dep == idx {
                return Err(format!("multi_step step {idx} depends on itself"));
            }
        }
        steps.push(item.into_draft_and_deps());
    }
    Ok(PlanRouterDecision::MultiStep {
        steps,
        reason: parsed
            .reason
            .unwrap_or_else(|| "multi-step plan work".into()),
    })
}

fn parse_router_step_draft(rest: &str) -> Result<RouterStepDraft, String> {
    Ok(RouterStepDraft {
        title: required_string(rest, "title")?,
        summary: required_string(rest, "summary")?,
        instruction_seed: required_string(rest, "instruction_seed")?,
        expected_files: field_array(rest, "expected_files")?.unwrap_or_default(),
        acceptance_criteria: field_array(rest, "acceptance_criteria")?.unwrap_or_default(),
        step_kind: field_string(rest, "step_kind")?.map(|value| StepKind::from_marker(&value)),
        verification_command: empty_to_none(field_string(rest, "verification_command")?),
        verification_type: empty_to_none(field_string(rest, "verification_type")?),
        dependencies: field_array(rest, "dependencies")?.unwrap_or_default(),
        parallel_group: field_parallel_group(rest)?,
    })
}

fn required_string(rest: &str, name: &str) -> Result<String, String> {
    field_string(rest, name)?.ok_or_else(|| format!("router response missing {name}"))
}

fn field_string(rest: &str, name: &str) -> Result<Option<String>, String> {
    let quoted = Regex::new(&format!(
        r#"{}\s*=\s*"((?:[^"\\]|\\.)*)""#,
        regex::escape(name)
    ))
    .map_err(|e| e.to_string())?;
    if let Some(caps) = quoted.captures(rest) {
        let raw = caps
            .get(1)
            .map(|m| m.as_str())
            .ok_or_else(|| format!("router response malformed {name}"))?;
        let parsed = serde_json::from_str::<String>(&format!("\"{raw}\""))
            .map_err(|e| format!("router response malformed {name}: {e}"))?;
        return Ok(Some(parsed));
    }

    if name == "reason" {
        let bare_reason = Regex::new(r#"reason\s*=\s*(.+)$"#).map_err(|e| e.to_string())?;
        if let Some(caps) = bare_reason.captures(rest) {
            return Ok(caps.get(1).map(|m| m.as_str().trim().to_string()));
        }
    }

    let bare = Regex::new(&format!(r#"{}\s*=\s*([^\s]+)"#, regex::escape(name)))
        .map_err(|e| e.to_string())?;
    Ok(bare
        .captures(rest)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().trim().to_string())))
}

fn field_array(rest: &str, name: &str) -> Result<Option<Vec<String>>, String> {
    let re = Regex::new(&format!(r#"{}\s*=\s*(\[[^\]]*\])"#, regex::escape(name)))
        .map_err(|e| e.to_string())?;
    let Some(caps) = re.captures(rest) else {
        return Ok(None);
    };
    let raw = caps
        .get(1)
        .map(|m| m.as_str())
        .ok_or_else(|| format!("router response malformed {name}"))?;
    let values = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|e| format!("router response malformed {name}: {e}"))?;
    Ok(Some(values))
}

fn field_parallel_group(rest: &str) -> Result<Option<i64>, String> {
    let Some(raw) = field_string(rest, "parallel_group")? else {
        return Ok(None);
    };
    let normalized = raw.trim();
    if normalized.is_empty()
        || normalized.eq_ignore_ascii_case("null")
        || normalized.eq_ignore_ascii_case("none")
    {
        return Ok(None);
    }
    normalized
        .parse::<i64>()
        .map(Some)
        .map_err(|e| format!("router response malformed parallel_group: {e}"))
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty()
            || trimmed.eq_ignore_ascii_case("null")
            || trimmed.eq_ignore_ascii_case("none")
        {
            None
        } else {
            Some(text)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_documents_plan_mutation_verbs() {
        // P6: the parser + IPC mapping for clarify/remove/supersede landed in
        // P2–P4, but the router only emits them once the system prompt teaches
        // the model the verbs and their output formats. Lock that teaching so a
        // later prompt edit can't silently re-disable production emission.
        let prompt = build_system_prompt();
        for needle in [
            "ROUTE clarify question=",
            "ROUTE remove target_step_id=",
            "ROUTE supersede target_step_id=",
            // P8a: lock the multi_step JSON-tail grammar (verb + opening brace).
            "ROUTE multi_step {",
            "verification_type=\"run|preview|manual|test\"",
            "static front-end",
        ] {
            assert!(
                prompt.contains(needle),
                "system prompt must document `{needle}`"
            );
        }
        // Guardrail: a router-emitted target_step_id is constrained to ids that
        // already exist in the plan (the IPC layer also degrades unknown ids to
        // Skip, but the prompt must not invite fabrication in the first place).
        assert!(
            prompt.contains("target_step_id MUST be one of the step ids"),
            "system prompt must constrain target_step_id to listed step ids"
        );
        // P7: duplicate detection is server-side plan truth (find_duplicate_step),
        // never a model verb — the prompt must not invite the router to
        // self-report duplicates.
        assert!(
            !prompt.contains("ROUTE duplicate"),
            "duplicate is backend-detected; the router must not emit a duplicate verb"
        );
    }

    #[test]
    fn parse_chat_route_with_quoted_reason() {
        assert_eq!(
            parse_route_decision("ROUTE chat reason=\"status question\"").unwrap(),
            PlanRouterDecision::Chat {
                reason: "status question".into()
            }
        );
    }

    #[test]
    fn parse_add_step_route_with_arrays() {
        let parsed = parse_route_decision(
            "ROUTE add_step title=\"Add auth\" summary=\"Add sign-in.\" instruction_seed=\"Implement it.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"test\" verification_command=\"pnpm test\" dependencies=[\"step-001\"] parallel_group=2 reason=\"new work\"",
        )
        .unwrap();

        match parsed {
            PlanRouterDecision::AddStep { draft, reason } => {
                assert_eq!(reason, "new work");
                assert_eq!(draft.title, "Add auth");
                assert_eq!(draft.expected_files, vec!["src/auth.ts"]);
                assert_eq!(draft.verification_type.as_deref(), Some("test"));
                assert_eq!(draft.dependencies, vec!["step-001"]);
                assert_eq!(draft.parallel_group, Some(2));
            }
            other => panic!("expected add_step, got {other:?}"),
        }
    }

    #[test]
    fn parse_clarify_route() {
        let parsed = parse_route_decision(
            "ROUTE clarify question=\"Which page needs the nav?\" candidate_intent=\"add nav\" suggested_criterion_ids=[\"ac-2\"] reason=\"ambiguous target\"",
        )
        .unwrap();
        assert_eq!(
            parsed,
            PlanRouterDecision::Clarify {
                question: "Which page needs the nav?".into(),
                candidate_intent: "add nav".into(),
                suggested_criterion_ids: vec!["ac-2".into()],
                reason: "ambiguous target".into(),
            }
        );
    }

    #[test]
    fn parse_remove_route() {
        assert_eq!(
            parse_route_decision("ROUTE remove target_step_id=\"step-003\" reason=\"obsolete\"")
                .unwrap(),
            PlanRouterDecision::Remove {
                target_step_id: "step-003".into(),
                reason: "obsolete".into(),
            }
        );
    }

    #[test]
    fn parse_supersede_route_reuses_draft_parser() {
        let parsed = parse_route_decision(
            "ROUTE supersede target_step_id=\"step-002\" title=\"Rework auth\" summary=\"Replace.\" instruction_seed=\"Redo it.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Works.\"] verification_type=\"test\" verification_command=\"pnpm test\" dependencies=[] parallel_group=null reason=\"replace\"",
        )
        .unwrap();
        match parsed {
            PlanRouterDecision::Supersede {
                target_step_id,
                replacement,
                reason,
            } => {
                assert_eq!(target_step_id, "step-002");
                assert_eq!(reason, "replace");
                assert_eq!(replacement.title, "Rework auth");
                assert_eq!(replacement.verification_type.as_deref(), Some("test"));
                assert_eq!(replacement.expected_files, vec!["src/auth.ts"]);
            }
            other => panic!("expected supersede, got {other:?}"),
        }
    }

    const MULTI_STEP_3: &str = "ROUTE multi_step {\"reason\":\"scaffold then wire\",\"steps\":[{\"title\":\"Skeleton\",\"summary\":\"Create module.\",\"instruction_seed\":\"Add module.\",\"expected_files\":[\"src/a.ts\"],\"acceptance_criteria\":[\"compiles\"],\"verification_type\":\"run\",\"verification_command\":\"pnpm build\",\"dependencies\":[],\"parallel_group\":null,\"depends_on\":[]},{\"title\":\"Wire\",\"summary\":\"Wire it.\",\"instruction_seed\":\"Wire module.\",\"expected_files\":[\"src/b.ts\"],\"acceptance_criteria\":[\"works\"],\"verification_type\":\"preview\",\"verification_command\":\"\",\"dependencies\":[\"step-001\"],\"parallel_group\":null,\"depends_on\":[0]},{\"title\":\"Test\",\"summary\":\"Cover it.\",\"instruction_seed\":\"Add tests.\",\"expected_files\":[\"src/c.ts\"],\"acceptance_criteria\":[\"green\"],\"verification_type\":\"test\",\"verification_command\":\"pnpm test\",\"dependencies\":[],\"parallel_group\":null,\"depends_on\":[0]}]}";

    #[test]
    fn parse_multi_step_route_parses_json_batch() {
        let parsed = parse_route_decision(MULTI_STEP_3).unwrap();
        match parsed {
            PlanRouterDecision::MultiStep { steps, reason } => {
                assert_eq!(reason, "scaffold then wire");
                assert_eq!(steps.len(), 3);
                assert_eq!(steps[0].0.title, "Skeleton");
                assert_eq!(steps[0].1, Vec::<usize>::new());
                // Sibling-index deps preserved verbatim (apply IPC rewrites them).
                assert_eq!(steps[1].1, vec![0]);
                assert_eq!(steps[2].1, vec![0]);
                // empty_to_none parity: an empty verification_command becomes None.
                assert_eq!(steps[1].0.verification_command, None);
                assert_eq!(steps[1].0.verification_type.as_deref(), Some("preview"));
                assert_eq!(steps[1].0.dependencies, vec!["step-001"]);
            }
            other => panic!("expected multi_step, got {other:?}"),
        }
    }

    #[test]
    fn parse_multi_step_rejects_empty_steps() {
        let err = parse_route_decision("ROUTE multi_step {\"reason\":\"x\",\"steps\":[]}")
            .expect_err("empty steps must be rejected");
        assert!(err.contains("no steps"), "unexpected error: {err}");
    }

    #[test]
    fn parse_multi_step_rejects_out_of_range_and_self_dep() {
        let out_of_range = "ROUTE multi_step {\"steps\":[{\"title\":\"A\",\"summary\":\"s\",\"instruction_seed\":\"i\",\"depends_on\":[5]}]}";
        assert!(parse_route_decision(out_of_range)
            .expect_err("out-of-range dep must be rejected")
            .contains("out-of-range"));
        let self_dep = "ROUTE multi_step {\"steps\":[{\"title\":\"A\",\"summary\":\"s\",\"instruction_seed\":\"i\",\"depends_on\":[0]}]}";
        assert!(parse_route_decision(self_dep)
            .expect_err("self dep must be rejected")
            .contains("itself"));
    }

    #[test]
    fn parse_multi_step_accepts_cycle_at_route_time() {
        // Cycle detection is OWNED by the apply IPC (topo_sort_drafts), not the
        // router. A 2-step cycle must still PARSE as a valid propose-only
        // MultiStep; locking this prevents a future maintainer from wrongly
        // adding cycle rejection here and diverging from the P5 apply contract.
        let cycle = "ROUTE multi_step {\"steps\":[{\"title\":\"A\",\"summary\":\"s\",\"instruction_seed\":\"i\",\"depends_on\":[1]},{\"title\":\"B\",\"summary\":\"s\",\"instruction_seed\":\"i\",\"depends_on\":[0]}]}";
        match parse_route_decision(cycle).unwrap() {
            PlanRouterDecision::MultiStep { steps, .. } => {
                assert_eq!(steps.len(), 2);
                assert_eq!(steps[0].1, vec![1]);
                assert_eq!(steps[1].1, vec![0]);
            }
            other => panic!("expected multi_step, got {other:?}"),
        }
    }

    #[test]
    fn parse_multi_step_malformed_json_errors() {
        // A malformed JSON tail must error (route_chat then fails closed to Skip)
        // rather than panic.
        let err = parse_route_decision("ROUTE multi_step {\"steps\":[{\"title\":")
            .expect_err("malformed json must error");
        assert!(
            err.contains("malformed multi_step"),
            "unexpected error: {err}"
        );
    }
}
