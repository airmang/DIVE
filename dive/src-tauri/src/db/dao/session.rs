use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::{NewSession, SessionOrigin, SessionRow};
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
    conn.execute("INSERT INTO Session(project_id, title, started_at, ended_at, status, origin) VALUES (?, ?, ?, ?, ?, ?)", params![row.project_id, row.title, now_ms(), row.ended_at, row.status, SessionOrigin::current().as_str()])?;
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
/// Newest session of a project (highest id), used to attach project-scoped
/// EventLog rows to a session so the session-scoped export reaches them.
pub fn latest_id_for_project(conn: &Connection, project_id: i64) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM Session WHERE project_id = ? ORDER BY id DESC LIMIT 1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )
    .ok()
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
    #[test]
    fn session_origin_prefers_valid_env_then_build_kind() {
        use SessionOrigin::*;
        assert_eq!(SessionOrigin::resolve(Some("qa"), false), Qa);
        assert_eq!(SessionOrigin::resolve(Some(" QA "), true), Qa);
        assert_eq!(SessionOrigin::resolve(Some("classroom"), true), Classroom);
        assert_eq!(SessionOrigin::resolve(Some("dev"), false), Dev);
        // An invalid override is ignored, never stored.
        assert_eq!(SessionOrigin::resolve(Some("pilot"), false), Classroom);
        assert_eq!(SessionOrigin::resolve(Some(""), true), Dev);
        assert_eq!(SessionOrigin::resolve(None, true), Dev);
        assert_eq!(SessionOrigin::resolve(None, false), Classroom);
    }
    #[test]
    fn latest_id_for_project_returns_newest_session_of_that_project() {
        let (db, _) = fresh_db();
        let mk_project = |path: &str| {
            project::insert(
                db.conn(),
                &NewProject {
                    name: "p".into(),
                    path: path.into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap()
        };
        let mk_session = |project_id| {
            insert(
                db.conn(),
                &NewSession {
                    project_id,
                    title: "s".into(),
                    ended_at: None,
                    status: "active".into(),
                },
            )
            .unwrap()
        };
        let p1 = mk_project("/tmp/latest-1");
        let p2 = mk_project("/tmp/latest-2");
        assert_eq!(latest_id_for_project(db.conn(), p1), None);
        let _older = mk_session(p1);
        let newer = mk_session(p1);
        let _other = mk_session(p2);
        assert_eq!(latest_id_for_project(db.conn(), p1), Some(newer));
    }
}
