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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterStepDraft {
    pub title: String,
    pub summary: String,
    pub instruction_seed: String,
    pub expected_files: Vec<String>,
    pub acceptance_criteria: Vec<String>,
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
    "You are DIVE's plan router. Decide whether the user's new chat message \
     should be proposed as a new step for the already-approved plan, or should \
     stay normal chat.\n\
     Return exactly one line. No Markdown. No explanation outside the line.\n\
     Use ROUTE chat for questions, status checks, clarifications, discussion, \
     or anything that does not add concrete implementation work.\n\
     Use ROUTE add_step only when the user asks for a new concrete task that \
     belongs in the current approved plan.\n\
     New steps must fit DIVE's execution envelope: one supervised turn, small \
     file-focused scope, no shell scripts, and verification_command must be one \
     no-shell command with explicit args and a 60 second budget.\n\
     Output formats:\n\
     ROUTE chat reason=\"short reason\"\n\
     ROUTE add_step title=\"...\" summary=\"...\" instruction_seed=\"...\" \
     expected_files=[\"path or glob\"] acceptance_criteria=[\"observable result\"] \
     verification_type=\"command|manual\" verification_command=\"command or empty\" \
     dependencies=[\"step-001\"] parallel_group=null reason=\"short reason\"\n\
     Existing step ids are the only allowed dependency values. Use null for \
     parallel_group unless a numeric existing group is clearly appropriate."
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
        Regex::new(r"^ROUTE\s+(add_step|chat)\b(?P<rest>.*)$").map_err(|e| e.to_string())?;
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
            draft: Box::new(RouterStepDraft {
                title: required_string(rest, "title")?,
                summary: required_string(rest, "summary")?,
                instruction_seed: required_string(rest, "instruction_seed")?,
                expected_files: field_array(rest, "expected_files")?.unwrap_or_default(),
                acceptance_criteria: field_array(rest, "acceptance_criteria")?.unwrap_or_default(),
                verification_command: empty_to_none(field_string(rest, "verification_command")?),
                verification_type: empty_to_none(field_string(rest, "verification_type")?),
                dependencies: field_array(rest, "dependencies")?.unwrap_or_default(),
                parallel_group: field_parallel_group(rest)?,
            }),
            reason: field_string(rest, "reason")?.unwrap_or_else(|| "new plan work".into()),
        }),
        _ => Err(format!("unsupported route action: {action}")),
    }
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
            "ROUTE add_step title=\"Add auth\" summary=\"Add sign-in.\" instruction_seed=\"Implement it.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"command\" verification_command=\"pnpm test\" dependencies=[\"step-001\"] parallel_group=2 reason=\"new work\"",
        )
        .unwrap();

        match parsed {
            PlanRouterDecision::AddStep { draft, reason } => {
                assert_eq!(reason, "new work");
                assert_eq!(draft.title, "Add auth");
                assert_eq!(draft.expected_files, vec!["src/auth.ts"]);
                assert_eq!(draft.dependencies, vec!["step-001"]);
                assert_eq!(draft.parallel_group, Some(2));
            }
            other => panic!("expected add_step, got {other:?}"),
        }
    }
}
