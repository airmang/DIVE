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
    state TEXT NOT NULL,
    verify_log TEXT,
    changed_files TEXT,
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
    kind TEXT NOT NULL CHECK(kind IN ('auto','manual')),
    label TEXT,
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

pub const CREATE_INDEXES: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS idx_card_session_position ON Card(session_id, position)",
    "CREATE INDEX IF NOT EXISTS idx_message_session_created_at ON Message(session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_event_log_session_created_at ON EventLog(session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_event_log_type ON EventLog(type)",
];
