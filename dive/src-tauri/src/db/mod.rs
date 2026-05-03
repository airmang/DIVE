//! SQLite 래퍼 및 DAO.

pub mod dao;
pub mod error;
pub mod migrations;
pub mod models;
pub mod schema;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use dao::*;
pub use error::DbError;
pub use models::*;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        configure_connection(&conn)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        configure_connection(&conn)?;
        Ok(Self { conn })
    }

    pub fn migrate(&mut self) -> Result<(), DbError> {
        migrations::migrate(&mut self.conn)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
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

    pub(crate) fn fresh_db() -> (Database, tempfile::NamedTempFile) {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let mut db = Database::open(tmp.path()).unwrap();
        db.migrate().unwrap();
        (db, tmp)
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
}
