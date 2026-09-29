//! Live mode: each gate-passing fixture's prompt goes to the configured
//! provider through `supervisor_output_for_context` — the provider runtime,
//! Pi sidecar, timeout and attempt loop the app uses (Constitution III). Manual
//! and local only (D-015-06); see `examples/eval_supervisor.rs`.
//!
//! Negative-control fixtures are skipped: their contexts duplicate a valid
//! fixture and only their recordings differ. Nothing here prints secrets or
//! raw model output; progress lines carry ids, outcomes and counts.

use std::fs;

use super::report::{EvalMode, EvalReport};
use super::{
    build_report, eval_result, fixture_problems, gate_closed_result, LoadedFixture, Recording,
    RecordingSource, ResultInput,
};
use crate::dive::supervisor::{
    supervisor_provoke_gate, validate_supervisor_decision_json, SupervisorDedupState,
    SupervisorDropReason, SupervisorValidationOutcome,
};
use crate::ipc::{
    response_from_validation, should_retry_supervisor, supervisor_evaluation_attempts,
    supervisor_output_for_context, AppState, StageCSupervisorOutput,
};

#[derive(Debug, Clone, Default)]
pub struct LiveOptions {
    /// Append each returned raw output to its fixture under the current
    /// promptVersion (`source: "live"`).
    pub write_recordings: bool,
}

#[derive(Debug)]
pub struct LiveRun {
    pub report: EvalReport,
    pub model_calls: usize,
    pub call_cap: usize,
    pub recordings_written: usize,
}

/// Hard cap on model calls per invocation (D-015-06).
pub fn call_cap(fixture_count: usize) -> usize {
    2 * fixture_count
}

/// Worst-case calls: every live candidate using every production attempt.
pub fn worst_case_calls(fixtures: &[LoadedFixture], attempts: usize) -> usize {
    live_candidates(fixtures).count() * attempts
}

fn live_candidates(fixtures: &[LoadedFixture]) -> impl Iterator<Item = &LoadedFixture> {
    fixtures.iter().filter(|loaded| {
        !loaded.is_negative_control() && supervisor_provoke_gate(&loaded.fixture.context)
    })
}

pub async fn run_live(
    state: &AppState,
    fixtures: &mut [LoadedFixture],
    options: &LiveOptions,
) -> Result<LiveRun, String> {
    let problems = fixtures
        .iter()
        .flat_map(fixture_problems)
        .collect::<Vec<_>>();
    if !problems.is_empty() {
        return Err(format!(
            "fixtures are inconsistent:\n  {}",
            problems.join("\n  ")
        ));
    }
    let prompt_version = super::current_prompt_version();
    let attempts = supervisor_evaluation_attempts();
    let cap = call_cap(fixtures.len());
    let worst_case = worst_case_calls(fixtures, attempts);
    if worst_case > cap {
        return Err(format!(
            "worst case {worst_case} model calls exceeds the cap of {cap} (2 × {} fixtures); \
             lower DIVE_SUPERVISOR_EVALUATION_ATTEMPTS (now {attempts})",
            fixtures.len()
        ));
    }
    let runtime = state.ensure_provider_runtime().await?;
    if runtime.kind.is_none()
        || runtime.config_id.is_none()
        || crate::pi_sidecar::parity::pi_provider_descriptor(runtime.kind.clone()).is_none()
    {
        return Err("no connected Pi-supported provider in the copied DB/secret store".into());
    }
    let model = runtime.model.clone();
    println!(
        "EVAL live promptVersion={prompt_version} kind={} model={model} attempts={attempts} \
         worst_case_calls={worst_case} cap={cap}",
        runtime.kind.as_str()
    );

    let recorded_at = super::utc_now_iso();
    let mut results = Vec::new();
    let mut new_recordings: Vec<(usize, Recording)> = Vec::new();
    let mut calls = 0;
    for (index, loaded) in fixtures.iter().enumerate() {
        if loaded.is_negative_control() {
            continue;
        }
        let context = &loaded.fixture.context;
        if !supervisor_provoke_gate(context) {
            results.push(gate_closed_result(loaded, 0, Some(0), "live", &model));
            continue;
        }
        let mut dedup = SupervisorDedupState::new();
        for attempt in 0..attempts {
            if calls >= cap {
                return Err(format!("model call cap {cap} reached; aborting"));
            }
            let output = supervisor_output_for_context(state, context).await;
            let (outcome, drop_reason, raw, retry) = match output {
                StageCSupervisorOutput::DecisionJson {
                    raw,
                    supervisor_model,
                    ..
                } => {
                    calls += 1;
                    let validation = validate_supervisor_decision_json(context, &raw, &mut dedup);
                    let retry = should_retry_supervisor(&response_from_validation(
                        String::new(),
                        validation.clone(),
                        None,
                    ));
                    new_recordings.push((
                        index,
                        Recording {
                            raw_output: raw.clone(),
                            model: supervisor_model.unwrap_or_else(|| model.clone()),
                            recorded_at: recorded_at.clone(),
                            source: RecordingSource::Live,
                        },
                    ));
                    (
                        validation.validation_outcome,
                        validation.drop_reason,
                        Some(raw),
                        retry,
                    )
                }
                StageCSupervisorOutput::Timeout => {
                    calls += 1;
                    let reason = SupervisorDropReason::Timeout;
                    (
                        SupervisorValidationOutcome::Dropped,
                        Some(reason),
                        None,
                        true,
                    )
                }
                StageCSupervisorOutput::SidecarError => {
                    calls += 1;
                    let reason = SupervisorDropReason::SidecarError;
                    (
                        SupervisorValidationOutcome::Dropped,
                        Some(reason),
                        None,
                        true,
                    )
                }
                // The prompt could not be built: no call was made.
                StageCSupervisorOutput::Drop(reason) => (
                    SupervisorValidationOutcome::Dropped,
                    Some(reason),
                    None,
                    false,
                ),
                // After an open gate these mean the runtime went away; the app
                // would fall back to a deterministic card, which is not a model
                // output, so the run stops instead of scoring it.
                StageCSupervisorOutput::RuntimeUnavailable
                | StageCSupervisorOutput::DomainShell => {
                    return Err(format!(
                        "{}: provider runtime unavailable after {calls} call(s); aborting",
                        loaded.fixture.id
                    ));
                }
            };
            println!(
                "EVAL fixture={} attempt={attempt} outcome={} drop={} calls={calls}",
                loaded.fixture.id,
                outcome.as_str(),
                drop_reason.map(|reason| reason.as_str()).unwrap_or("-")
            );
            results.push(eval_result(ResultInput {
                loaded,
                recording_index: attempt,
                attempt: Some(attempt),
                source: "live",
                model: &model,
                prompt_sent: raw.is_some()
                    || matches!(
                        drop_reason,
                        Some(SupervisorDropReason::Timeout | SupervisorDropReason::SidecarError)
                    ),
                outcome,
                drop_reason,
                raw_output: raw.as_deref(),
            }));
            if !retry {
                break;
            }
        }
    }

    let recordings_written = if options.write_recordings {
        write_recordings(fixtures, &prompt_version, new_recordings)?
    } else {
        0
    };
    let evaluated = fixtures
        .iter()
        .filter(|loaded| !loaded.is_negative_control())
        .count();
    Ok(LiveRun {
        report: build_report(EvalMode::Live, &prompt_version, evaluated, results, None),
        model_calls: calls,
        call_cap: cap,
        recordings_written,
    })
}

/// Appends recordings under `prompt_version` and rewrites each touched fixture
/// file (serde pretty JSON; run `pnpm prettier --write eval/` afterwards).
fn write_recordings(
    fixtures: &mut [LoadedFixture],
    prompt_version: &str,
    recordings: Vec<(usize, Recording)>,
) -> Result<usize, String> {
    let count = recordings.len();
    let mut touched = std::collections::BTreeSet::new();
    for (index, recording) in recordings {
        fixtures[index]
            .fixture
            .recorded
            .entry(prompt_version.to_string())
            .or_default()
            .push(recording);
        touched.insert(index);
    }
    for index in touched {
        let loaded = &fixtures[index];
        let json = serde_json::to_string_pretty(&loaded.fixture).map_err(|err| err.to_string())?;
        fs::write(&loaded.path, format!("{json}\n"))
            .map_err(|err| format!("{}: {err}", loaded.path.display()))?;
    }
    Ok(count)
}
