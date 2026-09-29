//! SupervisorAgent eval runner (spec 015, S-079, FR-030–FR-034).
//!
//! Loads the synthetic golden set in `dive/eval/supervisor/fixtures/`, runs it
//! through the production supervisor path and writes the JSON report that
//! `scripts/eval-report.mjs` renders. Fixture and report formats:
//! `dive/eval/supervisor/README.md`.
//!
//! - **recorded** (CI): every recording for a promptVersion goes through the
//!   real `validate_supervisor_decision_json`; no model is called.
//! - **live** (manual, [`live`]): each gate-passing fixture's real prompt goes
//!   through `supervisor_output_for_context` — the provider runtime and Pi
//!   sidecar the app uses — with the production attempt loop and a hard cap of
//!   `2 × fixture count` model calls (D-015-06).

pub mod live;
mod metrics;
pub mod report;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::dive::supervision_policy::supervision_policy;
use crate::dive::supervisor::{
    build_supervisor_prompt, dropped_validation_result, parse_supervisor_decision,
    supervisor_prompt_version, supervisor_provoke_gate, validate_supervisor_decision_json,
    SupervisorContext, SupervisorDedupState, SupervisorDropReason, SupervisorEvent, SupervisorMode,
    SupervisorValidationOutcome,
};
use crate::ipc::{
    response_from_validation, should_retry_supervisor, supervisor_evaluation_attempts,
};
use report::{
    CallOutcome, DecisionSummary, EvalMode, EvalReport, EvalResult, ExpectedSummary, GroupKey,
    REPORT_KIND, REPORT_SCHEMA_VERSION,
};

pub const FIXTURE_SCHEMA_VERSION: u8 = 1;

/// Every `SupervisorEvent`; `all_events_are_listed` keeps it exhaustive.
pub const ALL_EVENTS: [SupervisorEvent; 6] = [
    SupervisorEvent::AiClaimedDone,
    SupervisorEvent::VerifyEntered,
    SupervisorEvent::ScopeExpansion,
    SupervisorEvent::PlanDrafted,
    SupervisorEvent::DiffReady,
    SupervisorEvent::RetryLoop,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Split {
    Dev,
    Holdout,
}

impl Split {
    pub const ALL: [Split; 2] = [Split::Dev, Split::Holdout];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Holdout => "holdout",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingSource {
    HandAuthored,
    Live,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recording {
    pub raw_output: String,
    pub model: String,
    pub recorded_at: String,
    pub source: RecordingSource,
    /// Live recordings: the production attempt this output answered (0 =
    /// first try). A recording with `attempt: 0` starts a new trial; others
    /// continue the current one (see [`trials`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixtureExpect {
    pub should_provoke: bool,
    pub gate_passes: bool,
    pub allowed_concerns: Vec<String>,
    pub required_evidence_ref_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relevant_evidence_ref_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criterion_terms: Option<Vec<String>>,
    pub locale: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_drop_reason: Option<SupervisorDropReason>,
}

/// One fixture file. Field order is the file's key order, so a live
/// `--write-recordings` rewrite keeps the layout (run prettier afterwards).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fixture {
    pub schema_version: u8,
    pub id: String,
    pub event: SupervisorEvent,
    pub locale: String,
    pub mode: SupervisorMode,
    pub description: String,
    pub context: SupervisorContext,
    pub expect: FixtureExpect,
    pub recorded: BTreeMap<String, Vec<Recording>>,
}

#[derive(Debug, Clone)]
pub struct LoadedFixture {
    pub path: PathBuf,
    pub split: Split,
    pub fixture: Fixture,
}

impl LoadedFixture {
    fn is_negative_control(&self) -> bool {
        self.fixture.expect.expected_drop_reason.is_some()
    }
}

/// `dive/eval/supervisor/fixtures`.
pub fn default_fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("eval")
        .join("supervisor")
        .join("fixtures")
}

/// `<target dir>/eval`, honouring `CARGO_TARGET_DIR`.
pub fn default_report_dir() -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("target"))
        .join("eval")
}

/// `supervisor-<mode>-<promptVersion>.json` under [`default_report_dir`].
pub fn default_report_path(mode: EvalMode, prompt_version: &str) -> PathBuf {
    default_report_dir().join(format!(
        "supervisor-{}-{prompt_version}.json",
        mode.as_str()
    ))
}

/// The promptVersion the SupervisorAgent prompt currently renders to.
pub fn current_prompt_version() -> String {
    supervisor_prompt_version().render()
}

/// Reads `<root>/{dev,holdout}/*.json`, sorted by split then id. Every file
/// that does not deserialize is reported, not skipped.
pub fn load_fixtures(root: &Path) -> Result<Vec<LoadedFixture>, Vec<String>> {
    let mut fixtures = Vec::new();
    let mut errors = Vec::new();
    for split in Split::ALL {
        let dir = root.join(split.as_str());
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(err) => {
                errors.push(format!("{}: {err}", dir.display()));
                continue;
            }
        };
        let mut paths = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect::<Vec<_>>();
        paths.sort();
        for path in paths {
            let parsed = fs::read_to_string(&path)
                .map_err(|err| err.to_string())
                .and_then(|text| {
                    serde_json::from_str::<Fixture>(&text).map_err(|err| err.to_string())
                });
            match parsed {
                Ok(fixture) => fixtures.push(LoadedFixture {
                    path,
                    split,
                    fixture,
                }),
                Err(err) => errors.push(format!("{}: {err}", path.display())),
            }
        }
    }
    if errors.is_empty() {
        Ok(fixtures)
    } else {
        Err(errors)
    }
}

/// Fixture-level consistency the runner relies on: schema version, header
/// fields matching the context, the stored hash, and the provoke gate
/// agreeing with `expect.gatePasses`.
pub fn fixture_problems(loaded: &LoadedFixture) -> Vec<String> {
    let fixture = &loaded.fixture;
    let context = &fixture.context;
    let mut problems = Vec::new();
    let mut problem = |text: String| problems.push(format!("{}: {text}", fixture.id));
    if fixture.schema_version != FIXTURE_SCHEMA_VERSION {
        problem(format!("schemaVersion {}", fixture.schema_version));
    }
    if fixture.event != context.event || fixture.mode != context.mode {
        problem("event/mode differ from the context".into());
    }
    if fixture.locale != context.locale || fixture.expect.locale != context.locale {
        problem("locale differs from the context".into());
    }
    let hash = context.compute_context_hash();
    if hash != context.context_hash {
        problem(format!(
            "contextHash {} does not match its content ({hash})",
            context.context_hash
        ));
    }
    let gate = supervisor_provoke_gate(context);
    if gate != fixture.expect.gate_passes {
        problem(format!(
            "supervisor_provoke_gate is {gate} but expect.gatePasses is {}",
            fixture.expect.gate_passes
        ));
    }
    problems
}

/// Gate-passing fixtures with no recording for `prompt_version`.
pub fn fixtures_missing_recordings<'a>(
    fixtures: &'a [LoadedFixture],
    prompt_version: &str,
) -> Vec<&'a str> {
    fixtures
        .iter()
        .filter(|loaded| supervisor_provoke_gate(&loaded.fixture.context))
        .filter(|loaded| {
            loaded
                .fixture
                .recorded
                .get(prompt_version)
                .map_or(true, Vec::is_empty)
        })
        .map(|loaded| loaded.fixture.id.as_str())
        .collect()
}

pub fn missing_recordings_message(prompt_version: &str, missing: &[&str]) -> String {
    format!(
        "record fixtures for {prompt_version}: run the live eval (see dive/eval/supervisor/README.md); \
         {} gate-passing fixture(s) have no recording: {}",
        missing.len(),
        missing.join(", ")
    )
}

fn decision_summary(raw: &str) -> Option<DecisionSummary> {
    parse_supervisor_decision(raw)
        .ok()
        .map(|decision| DecisionSummary {
            concern: decision.concern,
            question: decision.question,
            evidence_ref_ids: decision.evidence_ref_ids,
            suggested_action_ids: decision.suggested_action_ids,
        })
}

pub(crate) struct ResultInput<'a> {
    pub loaded: &'a LoadedFixture,
    pub recording_index: usize,
    pub calls: Vec<CallOutcome>,
    pub source: &'a str,
    pub model: &'a str,
    pub prompt_sent: bool,
    pub outcome: SupervisorValidationOutcome,
    pub drop_reason: Option<SupervisorDropReason>,
    pub raw_output: Option<&'a str>,
}

pub(crate) fn eval_result(input: ResultInput<'_>) -> EvalResult {
    let fixture = &input.loaded.fixture;
    let decision = input.raw_output.and_then(decision_summary);
    let checks = metrics::checks_for(
        &fixture.expect,
        input.outcome,
        input.drop_reason,
        decision.as_ref(),
    );
    EvalResult {
        fixture_id: fixture.id.clone(),
        split: input.loaded.split,
        event: fixture.event,
        locale: fixture.locale.clone(),
        mode: fixture.mode,
        recording_index: input.recording_index,
        source: input.source.to_string(),
        model: input.model.to_string(),
        expected: ExpectedSummary {
            should_provoke: fixture.expect.should_provoke,
            expected_drop_reason: fixture.expect.expected_drop_reason,
        },
        gate_passes: supervisor_provoke_gate(&fixture.context),
        prompt_sent: input.prompt_sent,
        outcome: input.outcome,
        drop_reason: input.drop_reason,
        decision,
        checks,
        calls: input.calls,
    }
}

/// A closed gate sends no prompt: production records `none` / `provoke_false`.
pub(crate) fn gate_closed_result(
    loaded: &LoadedFixture,
    recording_index: usize,
    source: &str,
    model: &str,
) -> EvalResult {
    eval_result(ResultInput {
        loaded,
        recording_index,
        calls: Vec::new(),
        source,
        model,
        prompt_sent: false,
        outcome: SupervisorValidationOutcome::NoCard,
        drop_reason: Some(SupervisorDropReason::ProvokeFalse),
        raw_output: None,
    })
}

/// Groups results by (promptVersion, policyVersion, model, split).
pub(crate) fn build_report(
    mode: EvalMode,
    prompt_version: &str,
    fixture_count: usize,
    results: Vec<EvalResult>,
    note: Option<String>,
) -> EvalReport {
    let policy_version = supervision_policy().policy_version.clone();
    let mut grouped: BTreeMap<GroupKey, Vec<EvalResult>> = BTreeMap::new();
    for result in results {
        grouped
            .entry(GroupKey {
                split: result.split,
                prompt_version: prompt_version.to_string(),
                policy_version: policy_version.clone(),
                model: result.model.clone(),
            })
            .or_default()
            .push(result);
    }
    EvalReport {
        schema_version: REPORT_SCHEMA_VERSION,
        kind: REPORT_KIND.to_string(),
        mode,
        generated_at: utc_now_iso(),
        note,
        fixture_count,
        groups: grouped
            .into_iter()
            .map(|(key, results)| metrics::aggregate(key, results))
            .collect(),
    }
}

/// Outcome of a recorded run: the report plus every consistency problem
/// (fixture problems and missing recordings). CI fails on any problem.
#[derive(Debug)]
pub struct RecordedRun {
    pub report: EvalReport,
    pub problems: Vec<String>,
    pub missing_recordings: Vec<String>,
}

/// Recorded mode: replays each trial of stored raw outputs for
/// `prompt_version` through the production validation path and retry loop
/// (one result per trial, scored on its final call). Gate-closed fixtures do
/// not consult their recordings (no prompt is sent in production); they take
/// the recording's model/source for grouping, or `(no recording)` when there
/// is none.
pub fn run_recorded(fixtures: &[LoadedFixture], prompt_version: &str) -> RecordedRun {
    let max_attempts = supervisor_evaluation_attempts();
    let mut problems = fixtures
        .iter()
        .flat_map(fixture_problems)
        .collect::<Vec<_>>();
    let mut ids = BTreeSet::new();
    for loaded in fixtures {
        if !ids.insert(loaded.fixture.id.as_str()) {
            problems.push(format!("{}: duplicate fixture id", loaded.fixture.id));
        }
    }
    let missing_recordings = fixtures_missing_recordings(fixtures, prompt_version)
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();

    let mut results = Vec::new();
    for loaded in fixtures {
        let context = &loaded.fixture.context;
        let recordings = loaded
            .fixture
            .recorded
            .get(prompt_version)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if !supervisor_provoke_gate(context) {
            if recordings.is_empty() {
                results.push(gate_closed_result(loaded, 0, "none", "(no recording)"));
            }
            for (first, trial) in trials(recordings) {
                let source = recording_source_str(trial[0].source);
                results.push(gate_closed_result(loaded, first, source, &trial[0].model));
            }
            continue;
        }
        let prompt = build_supervisor_prompt(context);
        for (first, trial) in trials(recordings) {
            results.push(match &prompt {
                Ok(_) => replay_trial(loaded, first, &trial, max_attempts),
                // Production drops before any call when the prompt cannot be built.
                Err(reason) => {
                    let validation = dropped_validation_result(*reason);
                    eval_result(ResultInput {
                        loaded,
                        recording_index: first,
                        calls: Vec::new(),
                        source: recording_source_str(trial[0].source),
                        model: &trial[0].model,
                        prompt_sent: false,
                        outcome: validation.validation_outcome,
                        drop_reason: validation.drop_reason,
                        raw_output: None,
                    })
                }
            });
        }
    }
    RecordedRun {
        report: build_report(
            EvalMode::Recorded,
            prompt_version,
            fixtures.len(),
            results,
            None,
        ),
        problems,
        missing_recordings,
    }
}

/// Splits a promptVersion's recordings into trials: `(index of the trial's
/// first recording in the file, its recordings in attempt order)`. An attempt
/// sequence never mixes models: each model's recordings (in order of first
/// appearance) are that model's sequence in `recordedAt` order (ties keep file
/// order), and a live recording with `attempt: 0` starts a new trial within it.
pub fn trials(recordings: &[Recording]) -> Vec<(usize, Vec<&Recording>)> {
    let mut models = Vec::<&str>::new();
    for recording in recordings {
        if !models.contains(&recording.model.as_str()) {
            models.push(&recording.model);
        }
    }
    let mut out = Vec::new();
    for model in models {
        let mut sequence = recordings
            .iter()
            .enumerate()
            .filter(|(_, recording)| recording.model == model)
            .collect::<Vec<_>>();
        sequence.sort_by(|a, b| a.1.recorded_at.cmp(&b.1.recorded_at));
        for (position, (index, recording)) in sequence.into_iter().enumerate() {
            if position == 0 || recording.attempt == Some(0) {
                out.push((index, Vec::new()));
            }
            out.last_mut()
                .expect("a trial was started")
                .1
                .push(recording);
        }
    }
    out
}

/// Replays one trial through the production retry loop: each recording is the
/// next attempt's raw output, the loop stops where production would (a shown
/// card or a non-recoverable outcome) or after `max_attempts`, and the result
/// is that last call. Later recordings of the trial are not consulted.
fn replay_trial(
    loaded: &LoadedFixture,
    first: usize,
    trial: &[&Recording],
    max_attempts: usize,
) -> EvalResult {
    let context = &loaded.fixture.context;
    let mut dedup = SupervisorDedupState::new();
    let mut calls = Vec::new();
    let mut last = None;
    for recording in trial.iter().take(max_attempts) {
        let validation =
            validate_supervisor_decision_json(context, &recording.raw_output, &mut dedup);
        calls.push(CallOutcome {
            outcome: validation.validation_outcome,
            drop_reason: validation.drop_reason,
        });
        let retry = should_retry_supervisor(&response_from_validation(
            String::new(),
            validation.clone(),
            None,
        ));
        last = Some((recording, validation));
        if !retry {
            break;
        }
    }
    let (recording, validation) = last.expect("a trial has at least one recording");
    eval_result(ResultInput {
        loaded,
        recording_index: first,
        calls,
        source: recording_source_str(recording.source),
        model: &recording.model,
        prompt_sent: true,
        outcome: validation.validation_outcome,
        drop_reason: validation.drop_reason,
        raw_output: Some(recording.raw_output.as_str()),
    })
}

pub(crate) fn recording_source_str(source: RecordingSource) -> &'static str {
    match source {
        RecordingSource::HandAuthored => "hand-authored",
        RecordingSource::Live => "live",
    }
}

/// `YYYY-MM-DDTHH:MM:SSZ` for the current UTC time (no date crate in this build).
pub(crate) fn utc_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default();
    utc_iso(secs)
}

fn utc_iso(secs: i64) -> String {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant), proleptic Gregorian calendar.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

/// Writes the report as pretty JSON, creating parent directories.
pub fn write_report(report: &EvalReport, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("{}: {err}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(report).map_err(|err| err.to_string())?;
    fs::write(path, format!("{json}\n")).map_err(|err| format!("{}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_events_are_listed() {
        // Adding a SupervisorEvent variant breaks this match until ALL_EVENTS
        // (and the fixture set) covers it.
        for event in ALL_EVENTS {
            match event {
                SupervisorEvent::AiClaimedDone
                | SupervisorEvent::VerifyEntered
                | SupervisorEvent::ScopeExpansion
                | SupervisorEvent::PlanDrafted
                | SupervisorEvent::DiffReady
                | SupervisorEvent::RetryLoop => {}
            }
        }
        let unique = ALL_EVENTS.iter().collect::<std::collections::HashSet<_>>();
        assert_eq!(unique.len(), ALL_EVENTS.len());
    }

    fn fixture(id: &str) -> LoadedFixture {
        load_fixtures(&default_fixture_root())
            .expect("fixtures load")
            .into_iter()
            .find(|loaded| loaded.fixture.id == id)
            .expect("fixture exists")
    }

    fn recording(raw: &str, attempt: Option<usize>) -> Recording {
        Recording {
            raw_output: raw.to_string(),
            model: "hand-authored".into(),
            recorded_at: "2026-09-29".into(),
            source: RecordingSource::HandAuthored,
            attempt,
        }
    }

    fn live_recording(raw: &str, model: &str, recorded_at: &str) -> Recording {
        Recording {
            raw_output: raw.to_string(),
            model: model.into(),
            recorded_at: recorded_at.into(),
            source: RecordingSource::Live,
            attempt: None,
        }
    }

    fn replay(loaded: &LoadedFixture, trial: &[Recording], max_attempts: usize) -> EvalResult {
        replay_trial(loaded, 0, &trial.iter().collect::<Vec<_>>(), max_attempts)
    }

    /// Any valid recorded output of the fixture — these unit tests exercise the
    /// replay rules, so they must not depend on the current prompt version
    /// having recordings (a prompt bump would break them until the live eval).
    fn only_recording(loaded: &LoadedFixture) -> String {
        loaded
            .fixture
            .recorded
            .values()
            .flatten()
            .next()
            .expect("fixture has at least one recording")
            .raw_output
            .clone()
    }

    #[test]
    fn trials_split_at_live_attempt_zero_only() {
        let one = [recording("a", None), recording("b", None)];
        assert_eq!(trials(&one).len(), 1);
        let two_runs = [
            recording("a", Some(0)),
            recording("b", Some(1)),
            recording("c", Some(0)),
        ];
        let split = trials(&two_runs);
        assert_eq!(
            split
                .iter()
                .map(|(first, t)| (*first, t.len()))
                .collect::<Vec<_>>(),
            vec![(0, 2), (2, 1)]
        );
    }

    #[test]
    fn mixed_hand_authored_and_live_recordings_are_separate_trials_per_model() {
        let loaded = fixture("verify-claim-done-ko-work");
        let valid = only_recording(&loaded);
        let not_question = only_recording(&fixture("verify-not-question-ko-work"));
        let live = "openrouter/anthropic/claude-sonnet-5";
        // File order is not attempt order: the live model's first attempt
        // (a recoverable drop) is recorded earlier than its retry.
        let recordings = [
            recording(&valid, None),
            live_recording(&valid, live, "2026-09-29T04:11:00Z"),
            live_recording(&not_question, live, "2026-09-29T04:10:00Z"),
        ];
        let split = trials(&recordings);
        assert_eq!(
            split
                .iter()
                .map(|(first, trial)| (*first, trial[0].model.as_str(), trial.len()))
                .collect::<Vec<_>>(),
            vec![(0, "hand-authored", 1), (2, live, 2)]
        );

        let mut with_recordings = loaded.clone();
        with_recordings
            .fixture
            .recorded
            .insert(current_prompt_version(), recordings.to_vec());
        let run = run_recorded(&[with_recordings], &current_prompt_version());
        let groups = run
            .report
            .groups
            .iter()
            .map(|group| {
                let result = &group.results[0];
                (group.key.model.as_str(), result.outcome, result.calls.len())
            })
            .collect::<Vec<_>>();
        assert_eq!(
            groups,
            vec![
                ("hand-authored", SupervisorValidationOutcome::Shown, 1),
                (live, SupervisorValidationOutcome::Shown, 2),
            ]
        );
        let live_group = &run.report.groups[1];
        assert_eq!(live_group.result_count, 1);
        assert_eq!(live_group.provoke_agreement.agree, 1);
        assert_eq!(live_group.attempts.retries, 1);
    }

    #[test]
    fn a_trial_is_scored_on_the_final_call_of_the_retry_loop() {
        let loaded = fixture("verify-claim-done-ko-work");
        let valid = only_recording(&loaded);
        let not_question = only_recording(&fixture("verify-not-question-ko-work"));

        // Recoverable drop, then a shown card: final = shown, one retry.
        let trial = [recording(&not_question, None), recording(&valid, None)];
        let result = replay(&loaded, &trial, 3);
        assert_eq!(result.outcome, SupervisorValidationOutcome::Shown);
        assert_eq!(result.checks.provoke_agreement, Some(true));
        assert_eq!(result.calls.len(), 2);
        assert_eq!(
            result.calls[0].drop_reason,
            Some(SupervisorDropReason::NotQuestion)
        );

        // Production stops at the first shown card: later recordings unused.
        let trial = [recording(&valid, None), recording(&not_question, None)];
        assert_eq!(replay(&loaded, &trial, 3).calls.len(), 1);

        // Retries run out at max_attempts: final = the last dropped call.
        let trial = [
            recording(&not_question, None),
            recording(&not_question, None),
            recording(&valid, None),
        ];
        let result = replay(&loaded, &trial, 2);
        assert_eq!(result.calls.len(), 2);
        assert_eq!(result.drop_reason, Some(SupervisorDropReason::NotQuestion));
        assert_eq!(result.checks.provoke_agreement, Some(false));

        let group = metrics::aggregate(
            GroupKey {
                split: Split::Dev,
                prompt_version: "v".into(),
                policy_version: "p".into(),
                model: "m".into(),
            },
            vec![result, replay(&loaded, &[recording(&valid, None)], 3)],
        );
        assert_eq!(group.result_count, 2);
        assert_eq!(group.outcomes.shown, 1);
        assert_eq!(group.attempts.calls, 3);
        assert_eq!(group.attempts.retries, 1);
        assert_eq!(group.attempts.outcomes.dropped, 2);
        assert_eq!(group.attempts.drop_reasons["not_question"], 2);
    }

    #[test]
    fn utc_iso_formats_known_instants() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_iso(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_iso(1_790_000_000), "2026-09-21T14:13:20Z");
    }
}
