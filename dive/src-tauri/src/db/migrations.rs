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
];

pub const LATEST_SCHEMA_VERSION: i64 = 6;

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
