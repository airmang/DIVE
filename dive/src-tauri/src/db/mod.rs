//! SQLite 래퍼 및 DAO.

pub mod dao;
pub mod error;
pub mod migrations;
pub mod models;
pub mod schema;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use dao::*;
pub use error::DbError;
pub use models::*;

pub struct Database {
    conn: Connection,
    path: Option<PathBuf>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        configure_connection(&conn)?;
        Ok(Self {
            conn,
            path: Some(path),
        })
    }

    pub fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        configure_connection(&conn)?;
        Ok(Self { conn, path: None })
    }

    pub fn migrate(&mut self) -> Result<(), DbError> {
        tracing::info!(
            persistent = self.path.is_some(),
            "database migration starting"
        );
        self.backup_before_forward_migration()?;
        match migrations::migrate(&mut self.conn) {
            Ok(()) => {
                tracing::info!("database migration completed");
                Ok(())
            }
            Err(err) => {
                tracing::error!(
                    error = %crate::telemetry::redact_log_text(&err.to_string()),
                    "database migration failed"
                );
                Err(err)
            }
        }
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    fn backup_before_forward_migration(&self) -> Result<(), DbError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if !path.exists() {
            return Ok(());
        }
        let current: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if current == 0 || current >= migrations::LATEST_SCHEMA_VERSION {
            return Ok(());
        }

        let backup_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("backups");
        std::fs::create_dir_all(&backup_dir)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_path = backup_dir.join(format!("dive-v{current}-{stamp}.db"));
        // The connection runs in persistent WAL mode (configure_connection) with
        // no periodic checkpoint, so committed transactions can live only in the
        // -wal side file. Fold them into the main db file before copying it —
        // otherwise a force-quit before the next checkpoint leaves the backup
        // silently missing recently committed work.
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        std::fs::copy(path, backup_path)?;
        Ok(())
    }
}

fn configure_connection(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    Ok(())
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
pub(crate) mod tests {
    use super::Database;
    use crate::db::dao::project;
    use crate::db::models::NewProject;
    use crate::db::schema;

    pub(crate) fn fresh_db() -> (Database, tempfile::NamedTempFile) {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let mut db = Database::open(tmp.path()).unwrap();
        db.migrate().unwrap();
        (db, tmp)
    }

    pub(crate) fn seed_project(conn: &rusqlite::Connection) -> i64 {
        crate::db::dao::project::insert(
            conn,
            &crate::db::models::NewProject {
                name: "Project".into(),
                path: "/tmp/project".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap()
    }

    pub(crate) fn seed_project_session(conn: &rusqlite::Connection) -> (i64, i64) {
        let project_id = crate::db::dao::project::insert(
            conn,
            &crate::db::models::NewProject {
                name: "Project".into(),
                path: "/tmp/project".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let session_id = crate::db::dao::session::insert(
            conn,
            &crate::db::models::NewSession {
                project_id,
                title: "Session".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        (project_id, session_id)
    }

    #[test]
    fn disk_database_persists_after_reopen() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        {
            let mut db = Database::open(tmp.path()).unwrap();
            db.migrate().unwrap();
            project::insert(
                db.conn(),
                &NewProject {
                    name: "Persisted".into(),
                    path: "/tmp/persisted".into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap();
        }

        let mut reopened = Database::open(tmp.path()).unwrap();
        reopened.migrate().unwrap();
        let count: i64 = reopened
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM Project WHERE name = 'Persisted'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn forward_migration_creates_backup_for_existing_disk_db() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dive.db");
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            // A real DB whose schema_version is already 1 ran migration_v1, so
            // it has a Project table. migration_v18 (Project.status) is the
            // first migration to ALTER Project directly, so this fixture must
            // include it — earlier migrations only ever referenced Project via
            // FK, which SQLite doesn't validate at CREATE TABLE time.
            // migration_v19 additionally builds indexes directly on ToolCall and
            // EventLog (also created by migration_v1), so those must be present
            // too — CREATE INDEX, unlike an FK, requires the target table to
            // exist. (Message is recreated by migration_v8's guard, but include
            // it as well so the fixture faithfully mirrors a real v1 DB.)
            conn.execute_batch(schema::CREATE_PROJECT).unwrap();
            conn.execute_batch(schema::CREATE_WORKMAP).unwrap();
            conn.execute_batch(schema::CREATE_CARD).unwrap();
            conn.execute_batch(schema::CREATE_MESSAGE).unwrap();
            conn.execute_batch(schema::CREATE_TOOL_CALL).unwrap();
            conn.execute_batch(schema::CREATE_EVENT_LOG).unwrap();
            conn.execute(
                "CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO schema_version(version, applied_at) VALUES (1, 0)",
                [],
            )
            .unwrap();
        }

        let mut db = Database::open(&path).unwrap();
        db.migrate().unwrap();

        let backup_dir = dir.path().join("backups");
        let backups = std::fs::read_dir(backup_dir).unwrap().count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn forward_migration_backup_includes_uncheckpointed_wal_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dive.db");

        {
            // Database::open runs configure_connection, which puts the
            // connection in persistent WAL mode — matching production. Build
            // the same v1 fixture as the sibling backup test, then insert one
            // more row afterward so it lands only in the -wal side file (a
            // handful of small writes stays well under SQLite's default
            // 1000-page auto-checkpoint threshold).
            let mut db = Database::open(&path).unwrap();
            db.conn().execute_batch(schema::CREATE_PROJECT).unwrap();
            db.conn().execute_batch(schema::CREATE_WORKMAP).unwrap();
            db.conn().execute_batch(schema::CREATE_CARD).unwrap();
            db.conn().execute_batch(schema::CREATE_MESSAGE).unwrap();
            db.conn().execute_batch(schema::CREATE_TOOL_CALL).unwrap();
            db.conn().execute_batch(schema::CREATE_EVENT_LOG).unwrap();
            db.conn()
                .execute(
                    "CREATE TABLE schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
                    [],
                )
                .unwrap();
            db.conn()
                .execute(
                    "INSERT INTO schema_version(version, applied_at) VALUES (1, 0)",
                    [],
                )
                .unwrap();
            project::insert(
                db.conn(),
                &NewProject {
                    name: "WalOnly".into(),
                    path: "/tmp/wal-only".into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap();

            // Sanity check the fixture actually exercises the bug scenario:
            // the -wal side file must be non-empty (i.e. holding uncheckpointed
            // frames) before migrate() runs.
            let wal_path = dir.path().join("dive.db-wal");
            let wal_len = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);
            assert!(wal_len > 0, "fixture must have uncheckpointed WAL frames");

            db.migrate().unwrap();
        }

        let backup_dir = dir.path().join("backups");
        let mut entries = std::fs::read_dir(&backup_dir).unwrap();
        let backup_path = entries.next().unwrap().unwrap().path();
        assert!(entries.next().is_none(), "expected exactly one backup");

        let backup_conn = rusqlite::Connection::open(&backup_path).unwrap();
        let count: i64 = backup_conn
            .query_row(
                "SELECT COUNT(*) FROM Project WHERE name = 'WalOnly'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "backup file must include committed-but-uncheckpointed WAL data"
        );
    }
}
