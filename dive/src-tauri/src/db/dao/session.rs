use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::{NewSession, SessionRow};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        status: row.get(5)?,
    })
}

pub fn insert(conn: &Connection, row: &NewSession) -> Result<i64, DbError> {
    conn.execute("INSERT INTO Session(project_id, title, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?)", params![row.project_id, row.title, now_ms(), row.ended_at, row.status])?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<SessionRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, title, started_at, ended_at, status FROM Session WHERE id = ?",
            [id],
            map_row,
        )
        .optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<SessionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, started_at, ended_at, status FROM Session ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewSession) -> Result<(), DbError> {
    conn.execute(
        "UPDATE Session SET project_id = ?, title = ?, ended_at = ?, status = ? WHERE id = ?",
        params![row.project_id, row.title, row.ended_at, row.status, id],
    )?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Session WHERE id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::project;
    use crate::db::models::NewProject;
    use crate::db::tests::fresh_db;
    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let pid = project::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: "/tmp/s".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let id = insert(
            db.conn(),
            &NewSession {
                project_id: pid,
                title: "s".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().title, "s");
        update(
            db.conn(),
            id,
            &NewSession {
                project_id: pid,
                title: "s2".into(),
                ended_at: Some(1),
                status: "ended".into(),
            },
        )
        .unwrap();
        assert_eq!(list(db.conn()).unwrap()[0].status, "ended");
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn invalid_status_fails_check() {
        let (db, _) = fresh_db();
        let pid = project::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: "/tmp/s2".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        assert!(insert(
            db.conn(),
            &NewSession {
                project_id: pid,
                title: "s".into(),
                ended_at: None,
                status: "bad".into()
            }
        )
        .is_err());
    }
}
