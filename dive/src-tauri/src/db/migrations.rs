use rusqlite::{Connection, Transaction};

use crate::db::{now_ms, schema, DbError};

pub(crate) type MigrationFn = fn(&Transaction<'_>) -> rusqlite::Result<()>;

const MIGRATIONS: &[(i64, MigrationFn)] = &[
    (1, migration_v1),
    (2, migration_v2),
    (3, migration_v3),
    (4, migration_v4),
    (5, migration_v5),
    (6, migration_v6),
    (7, migration_v7),
    (8, migration_v8),
    (9, migration_v9),
    (10, migration_v10),
    (11, migration_v11),
    (12, migration_v12),
    (13, migration_v13),
    (14, migration_v14),
    (15, migration_v15),
];

pub const LATEST_SCHEMA_VERSION: i64 = 15;

pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    migrate_with_migrations(conn, MIGRATIONS)
}

pub(crate) fn migrate_with_migrations(
    conn: &mut Connection,
    migrations: &[(i64, MigrationFn)],
) -> Result<(), DbError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
        [],
    )?;
    let current = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    let latest = migrations
        .iter()
        .map(|(version, _)| *version)
        .max()
        .unwrap_or(0);
    if current > latest {
        return Err(DbError::FutureSchema {
            found: current,
            latest,
        });
    }

    for (version, migration) in migrations.iter().filter(|(version, _)| *version > current) {
        let tx = conn.transaction()?;
        migration(&tx).map_err(|source| DbError::Migration {
            version: *version,
            source,
        })?;
        tx.execute(
            "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
            (*version, now_ms()),
        )
        .map_err(|source| DbError::Migration {
            version: *version,
            source,
        })?;
        tx.commit().map_err(|source| DbError::Migration {
            version: *version,
            source,
        })?;
    }

    Ok(())
}

fn migration_v1(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(schema::CREATE_PROJECT)?;
    tx.execute_batch(schema::CREATE_SESSION)?;
    tx.execute_batch(schema::CREATE_WORKMAP)?;
    tx.execute_batch(schema::CREATE_CARD)?;
    tx.execute_batch(schema::CREATE_MESSAGE)?;
    tx.execute_batch(schema::CREATE_TOOL_CALL)?;
    tx.execute_batch(schema::CREATE_CHECKPOINT)?;
    tx.execute_batch(schema::CREATE_PROVIDER_CONFIG)?;
    tx.execute_batch(schema::CREATE_EVENT_LOG)?;

    for index in schema::CREATE_INDEXES {
        tx.execute_batch(index)?;
    }

    Ok(())
}

/// Task 3-1 — add `Workmap.current_card_id` so the I/V/E gates can pin a
/// single active card per session (spec §4.3, §4.6). Append-only ALTER;
/// existing rows get NULL. FK ON DELETE SET NULL handles card deletion.
fn migration_v2(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(schema::ALTER_WORKMAP_ADD_CURRENT_CARD_ID)?;
    Ok(())
}

fn migration_v3(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(schema::CREATE_MCP_SERVER)?;
    Ok(())
}

fn migration_v4(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let checkpoint_exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'Checkpoint'",
        [],
        |row| row.get(0),
    )?;
    if checkpoint_exists == 0 {
        tx.execute_batch(schema::CREATE_CHECKPOINT)?;
        return Ok(());
    }

    let has_changed_files: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Checkpoint') WHERE name = 'changed_files'",
        [],
        |row| row.get(0),
    )?;

    tx.execute_batch("ALTER TABLE Checkpoint RENAME TO Checkpoint_old;")?;
    tx.execute_batch(schema::CREATE_CHECKPOINT)?;
    if has_changed_files == 0 {
        tx.execute_batch(
            "INSERT INTO Checkpoint(id, session_id, card_id, git_sha, kind, label, changed_files, stats, created_at)
             SELECT id, session_id, card_id, git_sha, kind, label, '[]', '{\"added\":0,\"removed\":0,\"modified\":0}', created_at
             FROM Checkpoint_old;",
        )?;
    } else {
        tx.execute_batch(
            "INSERT INTO Checkpoint(id, session_id, card_id, git_sha, kind, label, changed_files, stats, created_at)
             SELECT id, session_id, card_id, git_sha, kind, label,
                    COALESCE(changed_files, '[]'),
                    COALESCE(stats, '{\"added\":0,\"removed\":0,\"modified\":0}'),
                    created_at
             FROM Checkpoint_old;",
        )?;
    }
    tx.execute_batch("DROP TABLE Checkpoint_old;")?;
    Ok(())
}

fn migration_v5(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let has_test_command: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'test_command'",
        [],
        |row| row.get(0),
    )?;
    if has_test_command == 0 {
        tx.execute_batch("ALTER TABLE Card ADD COLUMN test_command TEXT")?;
    }
    Ok(())
}

fn migration_v6(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    for (column, ty) in [
        ("assist_summary", "TEXT"),
        ("acceptance_criteria", "TEXT"),
        ("retrospective", "TEXT"),
        ("change_summary", "TEXT"),
    ] {
        let exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = ?",
            [column],
            |row| row.get(0),
        )?;
        if exists == 0 {
            tx.execute_batch(&format!("ALTER TABLE Card ADD COLUMN {column} {ty}"))?;
        }
    }
    Ok(())
}

fn migration_v7(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(schema::CREATE_INTERVIEW)?;
    tx.execute_batch(schema::CREATE_PLAN)?;
    tx.execute_batch(schema::CREATE_STEP)?;
    tx.execute_batch(schema::CREATE_STEP_SESSION_MAPPING)?;
    for index in schema::CREATE_V7_INDEXES {
        tx.execute_batch(index)?;
    }
    Ok(())
}

fn migration_v8(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let message_exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'Message'",
        [],
        |row| row.get(0),
    )?;
    if message_exists == 0 {
        tx.execute_batch(schema::CREATE_MESSAGE)?;
        return Ok(());
    }

    let has_reasoning_content: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Message') WHERE name = 'reasoning_content'",
        [],
        |row| row.get(0),
    )?;
    if has_reasoning_content == 0 {
        tx.execute_batch("ALTER TABLE Message ADD COLUMN reasoning_content TEXT")?;
    }
    Ok(())
}

fn migration_v9(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'approval_judgment'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        tx.execute_batch("ALTER TABLE Card ADD COLUMN approval_judgment TEXT")?;
    }
    Ok(())
}

fn migration_v10(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'approval_provenance'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        tx.execute_batch("ALTER TABLE Card ADD COLUMN approval_provenance TEXT")?;
    }
    Ok(())
}

fn migration_v11(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(schema::CREATE_PROJECT_SPEC_VERSION)?;
    tx.execute_batch(schema::CREATE_LIVE_PROJECT_SPEC_DRAFT)?;
    tx.execute_batch(schema::CREATE_PLAN_MUTATION)?;
    tx.execute_batch(schema::CREATE_OBJECTION)?;
    for index in schema::CREATE_V11_INDEXES {
        tx.execute_batch(index)?;
    }
    Ok(())
}

/// S-032 — widen the Checkpoint `kind` CHECK constraint to admit the
/// `auto-pre-edit` pre-edit anchor. Rebuilds the table (rename → recreate →
/// copy → drop) because SQLite cannot alter a CHECK constraint in place. This
/// also backfills `auto-pre-restore` for DBs created before it entered the
/// constraint. The Checkpoint table has only outgoing FKs (no table references
/// it), so the rename/recreate is safe.
fn migration_v12(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let checkpoint_sql: String = match tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Checkpoint'",
        [],
        |row| row.get(0),
    ) {
        Ok(sql) => sql,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            tx.execute_batch(schema::CREATE_CHECKPOINT)?;
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    if checkpoint_sql.contains("auto-pre-edit") {
        // Table was created by the current schema and already admits the new
        // anchor kind; nothing to rebuild. (Also avoids a needless FK-bearing
        // copy on DBs whose Checkpoint table was freshly created.)
        return Ok(());
    }

    // Genuinely old table: rebuild it to widen the constraint. Real DBs in this
    // branch always have the Session/Card FK parents (created in migration v1),
    // so the row copy resolves cleanly.
    tx.execute_batch("ALTER TABLE Checkpoint RENAME TO Checkpoint_old;")?;
    tx.execute_batch(schema::CREATE_CHECKPOINT)?;
    tx.execute_batch(
        "INSERT INTO Checkpoint(id, session_id, card_id, git_sha, kind, label, changed_files, stats, created_at)
         SELECT id, session_id, card_id, git_sha, kind, label, changed_files, stats, created_at
         FROM Checkpoint_old;",
    )?;
    tx.execute_batch("DROP TABLE Checkpoint_old;")?;
    Ok(())
}

/// S-033 — add the plan-mutation lifecycle columns to Step so steps can be
/// soft-removed / superseded instead of hard-deleted. Additive, guarded
/// ADD COLUMN (mirrors migration_v6); existing rows backfill to status='active'.
fn migration_v13(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    for (column, definition) in [
        (
            "status",
            "TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed','superseded'))",
        ),
        ("superseded_by_step_id", "TEXT"),
        ("suppression_reason", "TEXT"),
    ] {
        let exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('Step') WHERE name = ?",
            [column],
            |row| row.get(0),
        )?;
        if exists == 0 {
            tx.execute_batch(&format!(
                "ALTER TABLE Step ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    Ok(())
}

/// S-032 — persist the logical session snapshot on each checkpoint and widen
/// the `kind` CHECK constraint for plan-adjustment recovery anchors. Rebuilds
/// Checkpoint because SQLite cannot alter a CHECK constraint in place.
fn migration_v14(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let checkpoint_sql: String = match tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Checkpoint'",
        [],
        |row| row.get(0),
    ) {
        Ok(sql) => sql,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            tx.execute_batch(schema::CREATE_CHECKPOINT)?;
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    if checkpoint_sql.contains("session_state_snapshot")
        && checkpoint_sql.contains("auto-pre-pivot")
    {
        return Ok(());
    }

    let has_changed_files = checkpoint_column_exists(tx, "changed_files")?;
    let has_stats = checkpoint_column_exists(tx, "stats")?;
    let has_snapshot = checkpoint_column_exists(tx, "session_state_snapshot")?;
    let changed_files_expr = if has_changed_files {
        "COALESCE(changed_files, '[]')"
    } else {
        "'[]'"
    };
    let stats_expr = if has_stats {
        "COALESCE(stats, '{\"added\":0,\"removed\":0,\"modified\":0}')"
    } else {
        "'{\"added\":0,\"removed\":0,\"modified\":0}'"
    };
    let snapshot_expr = if has_snapshot {
        "session_state_snapshot"
    } else {
        "NULL"
    };

    tx.execute_batch("ALTER TABLE Checkpoint RENAME TO Checkpoint_old;")?;
    tx.execute_batch(schema::CREATE_CHECKPOINT)?;
    tx.execute_batch(&format!(
        "INSERT INTO Checkpoint(id, session_id, card_id, git_sha, kind, label, changed_files, stats, session_state_snapshot, created_at)
         SELECT id, session_id, card_id, git_sha, kind, label, {changed_files_expr}, {stats_expr}, {snapshot_expr}, created_at
         FROM Checkpoint_old;",
    ))?;
    tx.execute_batch("DROP TABLE Checkpoint_old;")?;
    Ok(())
}

fn checkpoint_column_exists(tx: &Transaction<'_>, column: &str) -> rusqlite::Result<bool> {
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Checkpoint') WHERE name = ?",
        [column],
        |row| row.get(0),
    )?;
    Ok(exists > 0)
}

/// S-039 Pass B — persist the D-stage step classification used by behavior-
/// preserving refactor/rename guidance. Additive, guarded ADD COLUMN; existing
/// rows backfill to the compile-safe `feature` default.
fn migration_v15(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('Step') WHERE name = 'step_kind'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        tx.execute_batch(
            "ALTER TABLE Step ADD COLUMN step_kind TEXT NOT NULL DEFAULT 'feature' CHECK(step_kind IN ('feature','refactor','rename','comment','debug'))",
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Transaction;

    use crate::db::tests::{fresh_db, seed_project_session};
    use crate::db::{migrations, Database, DbError};

    #[test]
    fn migrate_is_idempotent() {
        let (mut db, _tmp) = fresh_db();
        let before: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
            .unwrap();
        db.migrate().unwrap();
        let after: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn migration_creates_all_tables() {
        let (db, _tmp) = fresh_db();
        let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('Project','Session','Workmap','Card','Message','ToolCall','Checkpoint','ProviderConfig','EventLog')", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 9);
    }

    #[test]
    fn migration_creates_indexes() {
        let (db, _tmp) = fresh_db();
        let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_card_session_position','idx_message_session_created_at','idx_event_log_session_created_at','idx_event_log_type')", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 4);
    }

    #[test]
    fn migration_v2_adds_current_card_id_column() {
        let (db, _tmp) = fresh_db();
        let has_col: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Workmap') WHERE name = 'current_card_id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_col, 1);
    }

    #[test]
    fn migration_v3_creates_mcp_server_table() {
        let (db, _tmp) = fresh_db();
        let count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'McpServer'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_v4_adds_checkpoint_metadata_columns() {
        let (db, _tmp) = fresh_db();
        let cols: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Checkpoint') WHERE name IN ('changed_files','stats')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cols, 2);
        let (_, session_id) = seed_project_session(db.conn());
        db.conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, label, created_at) VALUES (?, 'a', 'auto-pre-restore', '복원 직전', 0)",
                [session_id],
            )
            .unwrap();
    }

    #[test]
    fn migration_v12_widens_checkpoint_kind_constraint() {
        // Reproduce a pre-S-032 Checkpoint table whose CHECK constraint predates
        // the `auto-pre-edit` anchor, then prove v12's rebuild widens it while
        // preserving existing rows.
        let (mut db, _tmp) = fresh_db();
        let (_, session_id) = seed_project_session(db.conn());
        db.conn()
            .execute_batch(
                "DROP TABLE Checkpoint;
                 CREATE TABLE Checkpoint (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL REFERENCES Session(id) ON DELETE CASCADE,
                    card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL,
                    git_sha TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('auto','manual','auto-pre-restore')),
                    label TEXT,
                    changed_files TEXT NOT NULL DEFAULT '[]',
                    stats TEXT NOT NULL DEFAULT '{\"added\":0,\"removed\":0,\"modified\":0}',
                    created_at INTEGER NOT NULL
                 );",
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, label, created_at) VALUES (?, 'sha-old', 'manual', 'keep', 1)",
                [session_id],
            )
            .unwrap();
        // Pre-migration, the new anchor kind is rejected by the old constraint.
        assert!(db
            .conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, created_at) VALUES (?, 'sha-new', 'auto-pre-edit', 2)",
                [session_id],
            )
            .is_err());

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v12(&tx).unwrap();
        tx.commit().unwrap();

        // Existing row preserved and the new anchor kind is now accepted.
        let kept: String = db
            .conn()
            .query_row(
                "SELECT label FROM Checkpoint WHERE git_sha = 'sha-old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kept, "keep");
        db.conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, created_at) VALUES (?, 'sha-new', 'auto-pre-edit', 2)",
                [session_id],
            )
            .unwrap();
    }

    #[test]
    fn migration_v14_adds_checkpoint_session_snapshot_and_pre_pivot_kind() {
        let (mut db, _tmp) = fresh_db();
        let (_, session_id) = seed_project_session(db.conn());
        db.conn()
            .execute_batch(
                "DROP TABLE Checkpoint;
                 CREATE TABLE Checkpoint (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL REFERENCES Session(id) ON DELETE CASCADE,
                    card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL,
                    git_sha TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('auto','manual','auto-pre-restore','auto-pre-edit')),
                    label TEXT,
                    changed_files TEXT NOT NULL DEFAULT '[]',
                    stats TEXT NOT NULL DEFAULT '{\"added\":0,\"removed\":0,\"modified\":0}',
                    created_at INTEGER NOT NULL
                 );",
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, label, changed_files, stats, created_at) VALUES (?, 'sha-old', 'manual', 'keep', '[\"a.ts\"]', '{\"added\":1,\"removed\":0,\"modified\":0}', 1)",
                [session_id],
            )
            .unwrap();
        assert!(db
            .conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, created_at) VALUES (?, 'sha-pivot', 'auto-pre-pivot', 2)",
                [session_id],
            )
            .is_err());

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v14(&tx).unwrap();
        tx.commit().unwrap();

        let has_snapshot_col: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Checkpoint') WHERE name = 'session_state_snapshot'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_snapshot_col, 1);
        let kept: (String, Option<String>, String) = db
            .conn()
            .query_row(
                "SELECT label, session_state_snapshot, changed_files FROM Checkpoint WHERE git_sha = 'sha-old'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(kept.0, "keep");
        assert_eq!(kept.1, None);
        assert_eq!(kept.2, "[\"a.ts\"]");
        db.conn()
            .execute(
                "INSERT INTO Checkpoint(session_id, git_sha, kind, created_at) VALUES (?, 'sha-pivot', 'auto-pre-pivot', 2)",
                [session_id],
            )
            .unwrap();

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v14(&tx).unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn migration_v13_adds_step_lifecycle_columns_and_backfills_active() {
        use crate::db::dao::plan as plan_dao;
        use crate::db::models::NewPlan;

        // Reproduce a pre-S-033 Step table (no lifecycle columns), seed a step,
        // then prove v13 adds the columns and backfills status='active'.
        let (mut db, _tmp) = fresh_db();
        let (project_id, _session_id) = seed_project_session(db.conn());
        let plan_id = plan_dao::insert(
            db.conn(),
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "g".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "draft".into(),
            },
        )
        .unwrap();
        db.conn()
            .execute_batch(
                "DROP TABLE Step;
                 CREATE TABLE Step (
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
                 );",
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO Step(plan_id, step_id, title, position, created_at, updated_at) VALUES (?, 'step-001', 'Old step', 1, 0, 0)",
                [plan_id],
            )
            .unwrap();
        let has_status_before: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Step') WHERE name = 'status'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_status_before, 0);

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v13(&tx).unwrap();
        tx.commit().unwrap();

        let (status, superseded, suppression): (String, Option<String>, Option<String>) = db
            .conn()
            .query_row(
                "SELECT status, superseded_by_step_id, suppression_reason FROM Step WHERE step_id = 'step-001'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "active");
        assert!(superseded.is_none());
        assert!(suppression.is_none());

        // Idempotent: re-running the guarded ADD COLUMNs is a no-op.
        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v13(&tx).unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn migration_v15_adds_step_kind_and_backfills_feature() {
        use crate::db::dao::plan as plan_dao;
        use crate::db::models::NewPlan;

        let (mut db, _tmp) = fresh_db();
        let (project_id, _session_id) = seed_project_session(db.conn());
        let plan_id = plan_dao::insert(
            db.conn(),
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "g".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "draft".into(),
            },
        )
        .unwrap();
        db.conn()
            .execute_batch(
                "DROP TABLE Step;
                 CREATE TABLE Step (
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
                    status TEXT NOT NULL DEFAULT 'active',
                    superseded_by_step_id TEXT,
                    suppression_reason TEXT,
                    UNIQUE(plan_id, step_id)
                 );",
            )
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO Step(plan_id, step_id, title, position, created_at, updated_at) VALUES (?, 'step-001', 'Old step', 1, 0, 0)",
                [plan_id],
            )
            .unwrap();

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v15(&tx).unwrap();
        tx.commit().unwrap();

        let step_kind: String = db
            .conn()
            .query_row(
                "SELECT step_kind FROM Step WHERE step_id = 'step-001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(step_kind, "feature");

        let tx = db.conn_mut().transaction().unwrap();
        super::migration_v15(&tx).unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn migration_v5_adds_card_test_command_column() {
        let (db, _tmp) = fresh_db();
        let has_col: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'test_command'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_col, 1);
    }

    #[test]
    fn migration_v6_adds_beginner_explanation_columns() {
        let (db, _tmp) = fresh_db();
        let cols: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name IN ('assist_summary','acceptance_criteria','retrospective','change_summary')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cols, 4);
    }

    #[test]
    fn schema_version_reaches_latest() {
        let (db, _tmp) = fresh_db();
        let latest: i64 = db
            .conn()
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(latest, migrations::LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn migration_v7_creates_interview_plan_step_tables() {
        let (db, _tmp) = fresh_db();
        let tables: Vec<String> = db
            .conn()
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Interview','Plan','Step','StepSessionMapping')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(tables.len(), 4);
    }

    #[test]
    fn migration_v7_creates_v7_indexes() {
        let (db, _tmp) = fresh_db();
        let count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_step_plan_position','idx_step_session_mapping_session','idx_step_session_mapping_card')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn migration_v8_adds_message_reasoning_content_column() {
        let (db, _tmp) = fresh_db();
        let has_col: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Message') WHERE name = 'reasoning_content'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(has_col, 1);
    }

    #[test]
    fn migration_v9_adds_approval_judgment_column() {
        let (mut db, _tmp) = fresh_db();
        migrations::migrate(db.conn_mut()).unwrap();
        let exists: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'approval_judgment'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn migration_v10_adds_approval_provenance_column() {
        let (mut db, _tmp) = fresh_db();
        migrations::migrate(db.conn_mut()).unwrap();
        let exists: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('Card') WHERE name = 'approval_provenance'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn migration_v11_creates_prd_lifecycle_tables() {
        let (db, _tmp) = fresh_db();
        let tables: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('ProjectSpecVersion','LiveProjectSpecDraft','PlanMutation','Objection')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4);

        let indexes: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_project_spec_version_project','idx_live_prd_draft_project','idx_plan_mutation_plan','idx_objection_plan')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 4);
    }

    #[test]
    fn future_schema_is_rejected() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        {
            let conn = rusqlite::Connection::open(tmp.path()).unwrap();
            conn.execute(
                "CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO schema_version(version, applied_at) VALUES (999, 0)",
                [],
            )
            .unwrap();
        }

        let mut db = Database::open(tmp.path()).unwrap();
        let err = db.migrate().unwrap_err();
        assert!(matches!(
            err,
            DbError::FutureSchema {
                found: 999,
                latest: migrations::LATEST_SCHEMA_VERSION
            }
        ));
    }

    #[test]
    fn failed_migration_rolls_back_original_file() {
        fn bad_migration(tx: &Transaction<'_>) -> rusqlite::Result<()> {
            tx.execute_batch("CREATE TABLE Sentinel(id INTEGER PRIMARY KEY);")?;
            tx.execute_batch("THIS IS NOT SQL")?;
            Ok(())
        }

        let tmp = tempfile::NamedTempFile::new().unwrap();
        let mut db = Database::open(tmp.path()).unwrap();
        let err =
            migrations::migrate_with_migrations(db.conn_mut(), &[(1, bad_migration)]).unwrap_err();
        assert!(matches!(err, DbError::Migration { version: 1, .. }));

        let conn = rusqlite::Connection::open(tmp.path()).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'Sentinel'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
