use super::*;

pub fn build_supervisor_prompt(
    context: &SupervisorContext,
) -> Result<String, SupervisorDropReason> {
    let context_json =
        serde_json::to_string(context).map_err(|_| SupervisorDropReason::ContextTooLarge)?;
    if context_json.len() > SUPERVISOR_PROMPT_MAX_BYTES {
        return Err(SupervisorDropReason::ContextTooLarge);
    }
    let concern = expected_concern_for_event(context.event);
    Ok(format!(
        concat!(
            "You are DIVE's dedicated SupervisorAgent for a novice coding workflow.\n",
            "You are a one-shot evaluator. You have no tools, no filesystem access, ",
            "no process access, no resource discovery, no long-term memory, and no shared ",
            "main-agent session.\n",
            "DIVE has already built deterministic evidence for this review event. ",
            "Return exactly one JSON object matching SupervisorDecision schemaVersion=1. ",
            "Output only the raw JSON object: no markdown, no code fences, and no text before or after it. ",
            "The object MUST contain exactly these keys: schemaVersion (number 1), provoke (boolean), ",
            "concern (string), severity (string), question (string), evidenceRefIds (string array), ",
            "suggestedActionIds (string array). Do not invent other keys such as passed, confidence, ",
            "rationale, criterionKey, or score. Set provoke=true, concern=\"{concern}\", and severity=\"caution\". ",
            "Use only evidenceRefIds and suggestedActionIds present in the context. ",
            "{action} ",
            "Never suggest continue_with_risk, verification_deferred, dismiss, or mark_irrelevant. ",
            "{question_instruction} ",
            "The question field MUST be phrased as an interrogative and end with '?'. ",
            "Example: {{\"schemaVersion\":1,\"provoke\":true,\"concern\":\"{concern}\",\"severity\":\"caution\",",
            "\"question\":\"…\",\"evidenceRefIds\":[\"agent.assistant_claim\"],\"suggestedActionIds\":[\"open_diff\"]}}\n\n",
            "SupervisorContext JSON:\n",
            "{context_json}"
        ),
        concern = concern,
        action = prompt_action_instruction(context.event),
        question_instruction = if locale_is_english(&context.locale) {
            "Ask one criterion-linked question, written in English, within 140 characters."
        } else {
            "Ask one criterion-linked question, written in Korean, within 140 characters."
        },
        context_json = context_json,
    ))
}

fn prompt_action_instruction(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => {
            "Suggested actions may only be link_criterion, split_scope, edit_prd, or dismiss_review."
        }
        SupervisorEvent::PlanDrafted => {
            "Suggested actions may only be add_verification_step, link_criterion, split_scope, edit_prd, or dismiss_review."
        }
        SupervisorEvent::DiffReady => {
            "Suggested actions may only be open_diff, ask_ai_for_rationale, revert_unrelated_changes, run_tests, or dismiss_review."
        }
        SupervisorEvent::RetryLoop => {
            "Suggested actions may only be create_repro_steps, rollback_last_change, open_diff, run_tests, split_scope, or dismiss_review. Do not make retry_with_ai the primary action."
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            "Suggested actions may only be open_diff, open_preview, run_tests, or run_app."
        }
    }
}
