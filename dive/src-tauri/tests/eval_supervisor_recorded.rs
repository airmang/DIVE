//! SupervisorAgent eval, recorded mode (spec 015 S-079, FR-031). Runs in CI:
//! every fixture deserializes into the real `SupervisorContext`, the golden set
//! covers every event, the current promptVersion has recordings, the stored
//! outputs go through the production validation path, and the report is
//! written. Live mode: `examples/eval_supervisor.rs`.

use std::collections::{BTreeSet, HashSet};
use std::path::PathBuf;

use dive_lib::eval::supervisor::live::{call_cap, run_live, worst_case_calls, LiveOptions};
use dive_lib::eval::supervisor::report::{EvalMode, EvalReport};
use dive_lib::eval::supervisor::{
    current_prompt_version, default_fixture_root, default_report_path, load_fixtures,
    missing_recordings_message, run_recorded, write_report, LoadedFixture, ALL_EVENTS,
};
use serde_json::Value;

fn fixtures() -> Vec<LoadedFixture> {
    load_fixtures(&default_fixture_root()).unwrap_or_else(|errors| {
        panic!(
            "every eval fixture must deserialize into the eval Fixture/SupervisorContext types:\n  {}",
            errors.join("\n  ")
        )
    })
}

#[test]
fn every_fixture_deserializes_and_every_event_is_covered() {
    let fixtures = fixtures();
    assert!(fixtures.len() >= 30, "{} fixtures", fixtures.len());
    let covered = fixtures
        .iter()
        .map(|loaded| loaded.fixture.event)
        .collect::<HashSet<_>>();
    for event in ALL_EVENTS {
        assert!(
            covered.contains(&event),
            "no eval fixture covers SupervisorEvent::{event:?}"
        );
    }
}

#[test]
fn current_prompt_version_has_recordings_on_every_gate_passing_fixture() {
    let fixtures = fixtures();
    let version = current_prompt_version();
    let run = run_recorded(&fixtures, &version);
    let missing = run
        .missing_recordings
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert!(
        missing.is_empty(),
        "{}",
        missing_recordings_message(&version, &missing)
    );
}

#[test]
fn recorded_run_is_consistent_controls_drop_and_report_is_written() {
    let fixtures = fixtures();
    let version = current_prompt_version();
    let run = run_recorded(&fixtures, &version);
    assert!(
        run.problems.is_empty(),
        "fixture problems:\n  {}",
        run.problems.join("\n  ")
    );

    let results = run
        .report
        .groups
        .iter()
        .flat_map(|group| &group.results)
        .collect::<Vec<_>>();
    let controls = results
        .iter()
        .filter(|result| result.expected.expected_drop_reason.is_some())
        .collect::<Vec<_>>();
    assert!(
        !controls.is_empty(),
        "the golden set has no negative controls"
    );
    for result in controls {
        assert_eq!(
            result.drop_reason, result.expected.expected_drop_reason,
            "negative control {} produced {:?}/{:?}",
            result.fixture_id, result.outcome, result.drop_reason
        );
    }
    let covered = results
        .iter()
        .map(|result| result.fixture_id.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        covered.len(),
        fixtures.len(),
        "every fixture yields a result"
    );

    let path = default_report_path(EvalMode::Recorded, &version);
    write_report(&run.report, &path).expect("write recorded report");
    let written: EvalReport =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("read report back"))
            .expect("written report deserializes");
    assert_eq!(written.groups, run.report.groups);
    println!("EVAL recorded report: {}", path.display());
}

/// Every key the writer emits exists in `file`, and (via
/// `deny_unknown_fields`) the file has no key the writer does not know.
/// Numbers are compared by shape only: the examples are rendered by
/// `scripts/eval-report.mjs` in its tests.
fn assert_same_keys(emitted: &Value, file: &Value, path: &str) {
    match (emitted, file) {
        (Value::Object(emitted), Value::Object(file)) => {
            for (key, value) in emitted {
                let next = format!("{path}.{key}");
                let other = file
                    .get(key)
                    .unwrap_or_else(|| panic!("example report lacks {next}"));
                assert_same_keys(value, other, &next);
            }
        }
        (Value::Array(emitted), Value::Array(file)) => {
            for (index, (value, other)) in emitted.iter().zip(file).enumerate() {
                assert_same_keys(value, other, &format!("{path}[{index}]"));
            }
        }
        _ => {}
    }
}

#[test]
fn example_reports_match_the_report_schema_the_runner_writes() {
    let examples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../eval/supervisor/examples");
    for name in ["report-recorded.json", "report-candidate.json"] {
        let text = std::fs::read_to_string(examples.join(name)).expect("read example report");
        let report: EvalReport = serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!("{name} does not match the runner's report schema: {err}")
        });
        let file: Value = serde_json::from_str(&text).expect("example is JSON");
        let emitted = serde_json::to_value(&report).expect("serialize example");
        assert_same_keys(&emitted, &file, name);
    }
}

#[test]
fn a_prompt_version_without_recordings_fails_with_the_record_instruction() {
    // What CI reports after a supervisor prompt semver bump that nobody
    // re-recorded: the same check as above, against a version with no key.
    let fixtures = fixtures();
    let run = run_recorded(&fixtures, "9.9.9+00000000");
    assert!(!run.missing_recordings.is_empty());
    let missing = run
        .missing_recordings
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let message = missing_recordings_message("9.9.9+00000000", &missing);
    assert!(
        message.starts_with("record fixtures for 9.9.9+00000000: run the live eval"),
        "{message}"
    );
}

#[test]
fn live_call_cap_fits_the_production_attempts() {
    let fixtures = fixtures();
    let cap = call_cap(fixtures.len());
    // Default DIVE_SUPERVISOR_EVALUATION_ATTEMPTS is 3; the run aborts before
    // any call when the worst case would exceed 2 × fixture count.
    assert!(
        worst_case_calls(&fixtures, 3) <= cap,
        "{} > {cap}",
        worst_case_calls(&fixtures, 3)
    );
    assert!(worst_case_calls(&fixtures, 5) > cap);
}

#[tokio::test]
async fn live_mode_refuses_to_run_without_a_connected_pi_provider() {
    let mut fixtures = fixtures();
    let state = dive_lib::AppState::dev_mock();
    let error = run_live(&state, &mut fixtures, &LiveOptions::default())
        .await
        .expect_err("the mock provider is not a Pi provider");
    assert!(
        error.contains("no connected Pi-supported provider"),
        "{error}"
    );
}
