use rusqlite::{Connection, Transaction};

use crate::db::{now_ms, schema, DbError};

type MigrationFn = fn(&Transaction<'_>) -> rusqlite::Result<()>;

const MIGRATIONS: &[(i64, MigrationFn)] = &[(1, migration_v1)];

pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
        [],
    )?;
    let current = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    for (version, migration) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
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

#[cfg(test)]
mod tests {
    use crate::db::tests::fresh_db;

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
}
