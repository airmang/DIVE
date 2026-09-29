//! SupervisorAgent eval runner CLI (spec 015 S-079). See
//! `dive/eval/supervisor/README.md` ("How to run").
//!
//!   cargo run --features dev-mock --example eval_supervisor -- recorded \
//!       [--prompt-version <v>] [--fixtures <dir>] [--out <file>] [--note <text>]
//!   cargo run --features dev-mock --example eval_supervisor -- live --db <copied dive.db> \
//!       [--write-recordings] [--fixtures <dir>] [--out <file>]
//!
//! Live mode copies the given database into a temp directory before opening
//! it (migrations never touch the original) and reads provider secrets the way
//! the app does: `DIVE_SECRET_BACKEND=local-file` + `DIVE_LOCAL_SECRET_PATH`,
//! otherwise the OS keyring.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use dive_lib::auth;
use dive_lib::eval::supervisor::live::{run_live, LiveOptions};
use dive_lib::eval::supervisor::report::EvalMode;
use dive_lib::eval::supervisor::{
    current_prompt_version, default_fixture_root, default_report_path, load_fixtures,
    missing_recordings_message, run_recorded, write_report,
};
use dive_lib::ipc::ProviderRuntime;
use dive_lib::{Database, MockProvider};

const USAGE: &str = "usage: eval_supervisor recorded [--prompt-version <v>] [--fixtures <dir>] [--out <file>] [--note <text>]\n       eval_supervisor live --db <copied dive.db> [--write-recordings] [--fixtures <dir>] [--out <file>]";

#[derive(Default)]
struct Args {
    mode: String,
    prompt_version: Option<String>,
    fixtures: Option<PathBuf>,
    out: Option<PathBuf>,
    note: Option<String>,
    db: Option<PathBuf>,
    write_recordings: bool,
}

fn parse_args() -> Result<Args, String> {
    // `pnpm eval:supervisor:* -- <args>` forwards the separator itself.
    let mut raw = std::env::args().skip(1).filter(|arg| arg != "--");
    let mut args = Args {
        mode: raw.next().ok_or(USAGE)?,
        ..Args::default()
    };
    while let Some(arg) = raw.next() {
        let mut value = |flag: &str| raw.next().ok_or(format!("{flag} needs a value"));
        match arg.as_str() {
            "--prompt-version" => args.prompt_version = Some(value(&arg)?),
            "--fixtures" => args.fixtures = Some(value(&arg)?.into()),
            "--out" => args.out = Some(value(&arg)?.into()),
            "--note" => args.note = Some(value(&arg)?),
            "--db" => args.db = Some(value(&arg)?.into()),
            "--write-recordings" => args.write_recordings = true,
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    if !matches!(args.mode.as_str(), "recorded" | "live") {
        return Err(USAGE.to_string());
    }
    Ok(args)
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let result = if args.mode == "recorded" {
        recorded(&args)
    } else {
        tokio::runtime::Runtime::new()
            .map_err(|err| err.to_string())
            .and_then(|runtime| runtime.block_on(live(&args)))
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("eval_supervisor: {message}");
            ExitCode::FAILURE
        }
    }
}

fn recorded(args: &Args) -> Result<(), String> {
    let root = args.fixtures.clone().unwrap_or_else(default_fixture_root);
    let fixtures = load_fixtures(&root).map_err(|errors| errors.join("\n"))?;
    let version = args
        .prompt_version
        .clone()
        .unwrap_or_else(current_prompt_version);
    let mut run = run_recorded(&fixtures, &version);
    run.report.note = args.note.clone();
    let path = args
        .out
        .clone()
        .unwrap_or_else(|| default_report_path(EvalMode::Recorded, &version));
    write_report(&run.report, &path)?;
    println!(
        "EVAL recorded promptVersion={version} report={}",
        path.display()
    );
    let mut failures = run.problems;
    if !run.missing_recordings.is_empty() {
        let missing = run
            .missing_recordings
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        failures.push(missing_recordings_message(&version, &missing));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

async fn live(args: &Args) -> Result<(), String> {
    let db_path = args
        .db
        .as_deref()
        .ok_or("live mode needs --db <copied dive.db>")?;
    let root = args.fixtures.clone().unwrap_or_else(default_fixture_root);
    let mut fixtures = load_fixtures(&root).map_err(|errors| errors.join("\n"))?;
    let work = tempfile::tempdir().map_err(|err| err.to_string())?;
    let db_copy = copy_database(db_path, work.path())?;
    let mut db = Database::open(&db_copy).map_err(|err| err.to_string())?;
    db.migrate().map_err(|err| err.to_string())?;
    let project_root = work.path().join("project");
    std::fs::create_dir_all(&project_root).map_err(|err| err.to_string())?;
    let state = dive_lib::AppState::new(
        db,
        Arc::new(MockProvider::new(Vec::new())),
        project_root,
        "mock".into(),
    );
    let state = if std::env::var("DIVE_SECRET_BACKEND").ok().as_deref() == Some("local-file") {
        let secret_path = std::env::var_os("DIVE_LOCAL_SECRET_PATH")
            .map(PathBuf::from)
            .ok_or("DIVE_SECRET_BACKEND=local-file needs DIVE_LOCAL_SECRET_PATH")?;
        state.with_keyring(Arc::new(auth::LocalFileKeyring::new(secret_path)))
    } else {
        state
    };
    // Start empty so the runtime hydrates from the copied DB + secrets exactly
    // like the app's first supervisor call.
    state.swap_runtime(ProviderRuntime::none())?;

    let options = LiveOptions {
        write_recordings: args.write_recordings,
    };
    let run = run_live(&state, &mut fixtures, &options).await?;
    let version = current_prompt_version();
    let path = args
        .out
        .clone()
        .unwrap_or_else(|| default_report_path(EvalMode::Live, &version));
    write_report(&run.report, &path)?;
    println!(
        "EVAL live done calls={} cap={} recordings_written={} report={}",
        run.model_calls,
        run.call_cap,
        run.recordings_written,
        path.display()
    );
    if run.recordings_written > 0 {
        println!("EVAL next: pnpm prettier --write eval/supervisor/fixtures && pnpm eval:fixtures");
    }
    Ok(())
}

/// Copies `dive.db` (and its `-wal`/`-shm` siblings, when present) into `dir`.
fn copy_database(source: &Path, dir: &Path) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err(format!("{} is not a file", source.display()));
    }
    let target = dir.join("dive.db");
    std::fs::copy(source, &target).map_err(|err| format!("copy {}: {err}", source.display()))?;
    for suffix in ["-wal", "-shm"] {
        let sibling = PathBuf::from(format!("{}{suffix}", source.display()));
        if sibling.is_file() {
            std::fs::copy(&sibling, dir.join(format!("dive.db{suffix}")))
                .map_err(|err| format!("copy {}: {err}", sibling.display()))?;
        }
    }
    Ok(target)
}
