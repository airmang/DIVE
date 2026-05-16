pub const CREATE_PROJECT: &str = "
CREATE TABLE IF NOT EXISTS Project (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    provider_default TEXT,
    model_default TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
)";

pub const CREATE_SESSION: &str = "
CREATE TABLE IF NOT EXISTS Session (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('active','ended','archived'))
)";

pub const CREATE_WORKMAP: &str = "
CREATE TABLE IF NOT EXISTS Workmap (
    session_id INTEGER PRIMARY KEY REFERENCES Session(id) ON DELETE CASCADE,
    current_stage TEXT NOT NULL CHECK(current_stage IN ('D','I','V','E')),
    collapsed INTEGER NOT NULL DEFAULT 0
)";

pub const CREATE_CARD: &str = "
CREATE TABLE IF NOT EXISTS Card (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES Session(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    instruction TEXT,
    assist_summary TEXT,
    acceptance_criteria TEXT,
    retrospective TEXT,
    change_summary TEXT,
    state TEXT NOT NULL,
    verify_log TEXT,
    changed_files TEXT,
    test_command TEXT,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
)";

pub const CREATE_MESSAGE: &str = "
CREATE TABLE IF NOT EXISTS Message (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES Session(id) ON DELETE CASCADE,
    card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
    content TEXT NOT NULL,
    reasoning_content TEXT,
    tool_calls TEXT,
    usage TEXT,
    provider TEXT,
    model TEXT,
    created_at INTEGER NOT NULL
)";

pub const CREATE_TOOL_CALL: &str = "
CREATE TABLE IF NOT EXISTS ToolCall (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES Message(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT,
    approved INTEGER,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('safe','caution','danger')),
    created_at INTEGER NOT NULL
)";

pub const CREATE_CHECKPOINT: &str = "
CREATE TABLE IF NOT EXISTS Checkpoint (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES Session(id) ON DELETE CASCADE,
    card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL,
    git_sha TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('auto','manual','auto-pre-restore')),
    label TEXT,
    changed_files TEXT NOT NULL DEFAULT '[]',
    stats TEXT NOT NULL DEFAULT '{\"added\":0,\"removed\":0,\"modified\":0}',
    created_at INTEGER NOT NULL
)";

pub const CREATE_PROVIDER_CONFIG: &str = "
CREATE TABLE IF NOT EXISTS ProviderConfig (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK(auth_type IN ('api_key','oauth')),
    base_url TEXT,
    config TEXT NOT NULL DEFAULT '{}'
)";

pub const CREATE_EVENT_LOG: &str = "
CREATE TABLE IF NOT EXISTS EventLog (
    id INTEGER PRIMARY KEY,
    session_id INTEGER REFERENCES Session(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
)";

pub const CREATE_INTERVIEW: &str = "
CREATE TABLE IF NOT EXISTS Interview (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
    goal TEXT NOT NULL,
    questions TEXT NOT NULL DEFAULT '[]',
    unresolved_questions TEXT NOT NULL DEFAULT '[]',
    intent_summary TEXT,
    status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','discarded')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id)
)";

pub const CREATE_PLAN: &str = "
CREATE TABLE IF NOT EXISTS Plan (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
    interview_id INTEGER REFERENCES Interview(id) ON DELETE SET NULL,
    goal TEXT NOT NULL,
    intent_summary TEXT,
    scope TEXT DEFAULT '[]',
    non_goals TEXT DEFAULT '[]',
    constraints TEXT DEFAULT '[]',
    acceptance_criteria TEXT DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('draft','approved')),
    created_at INTEGER NOT NULL,
    approved_at INTEGER,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id)
)";

pub const CREATE_STEP: &str = "
CREATE TABLE IF NOT EXISTS Step (
    id INTEGER PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES Plan(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    instruction_seed TEXT,
    expected_files TEXT DEFAULT '[]',
    acceptance_criteria TEXT DEFAULT '[]',
    verification_kind TEXT,
    verification_command TEXT,
    verification_manual_check TEXT,
    dependencies TEXT DEFAULT '[]',
    parallel_group TEXT,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(plan_id, step_id)
)";

pub const CREATE_STEP_SESSION_MAPPING: &str = "
CREATE TABLE IF NOT EXISTS StepSessionMapping (
    id INTEGER PRIMARY KEY,
    step_id INTEGER NOT NULL REFERENCES Step(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES Session(id) ON DELETE SET NULL,
    card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL,
    state_path TEXT,
    status TEXT NOT NULL CHECK(status IN ('planned','blocked','ready','in_progress','review','done','shipped')),
    started_at INTEGER,
    completed_at INTEGER,
    checkpoint_ids TEXT DEFAULT '[]',
    verification_status TEXT,
    verification_evidence TEXT,
    user_decision TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(step_id)
)";

pub const CREATE_V7_INDEXES: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS idx_step_plan_position ON Step(plan_id, position)",
    "CREATE INDEX IF NOT EXISTS idx_step_session_mapping_session ON StepSessionMapping(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_step_session_mapping_card ON StepSessionMapping(card_id)",
];

pub const CREATE_INDEXES: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS idx_card_session_position ON Card(session_id, position)",
    "CREATE INDEX IF NOT EXISTS idx_message_session_created_at ON Message(session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_event_log_session_created_at ON EventLog(session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_event_log_type ON EventLog(type)",
];

pub const ALTER_WORKMAP_ADD_CURRENT_CARD_ID: &str =
    "ALTER TABLE Workmap ADD COLUMN current_card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL";

pub const CREATE_MCP_SERVER: &str = "
CREATE TABLE IF NOT EXISTS McpServer (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
    command TEXT,
    args TEXT,
    env TEXT,
    url TEXT,
    headers TEXT,
    default_risk TEXT NOT NULL DEFAULT 'caution' CHECK(default_risk IN ('safe','caution','danger')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
)";
