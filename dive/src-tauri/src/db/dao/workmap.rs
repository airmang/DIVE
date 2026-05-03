use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::{NewWorkmap, WorkmapRow};
use crate::db::DbError;

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkmapRow> {
    Ok(WorkmapRow {
        session_id: row.get(0)?,
        current_stage: row.get(1)?,
        collapsed: row.get(2)?,
    })
}
pub fn upsert(conn: &Connection, row: &NewWorkmap) -> Result<(), DbError> {
    conn.execute("INSERT INTO Workmap(session_id, current_stage, collapsed) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET current_stage = excluded.current_stage, collapsed = excluded.collapsed", params![row.session_id, row.current_stage, row.collapsed])?;
    Ok(())
}
pub fn insert(conn: &Connection, row: &NewWorkmap) -> Result<i64, DbError> {
    upsert(conn, row)?;
    Ok(row.session_id)
}
pub fn get(conn: &Connection, session_id: i64) -> Result<Option<WorkmapRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT session_id, current_stage, collapsed FROM Workmap WHERE session_id = ?",
            [session_id],
            map_row,
        )
        .optional()?)
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<WorkmapRow>, DbError> {
    get(conn, id)
}
pub fn list(conn: &Connection) -> Result<Vec<WorkmapRow>, DbError> {
    let mut stmt = conn
        .prepare("SELECT session_id, current_stage, collapsed FROM Workmap ORDER BY session_id")?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewWorkmap) -> Result<(), DbError> {
    conn.execute(
        "UPDATE Workmap SET current_stage = ?, collapsed = ? WHERE session_id = ?",
        params![row.current_stage, row.collapsed, id],
    )?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Workmap WHERE session_id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project_session};
    #[test]
    fn upsert_inserts_and_updates() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        upsert(
            db.conn(),
            &NewWorkmap {
                session_id: sid,
                current_stage: "D".into(),
                collapsed: false,
            },
        )
        .unwrap();
        assert!(!get(db.conn(), sid).unwrap().unwrap().collapsed);
        upsert(
            db.conn(),
            &NewWorkmap {
                session_id: sid,
                current_stage: "I".into(),
                collapsed: true,
            },
        )
        .unwrap();
        let row = get(db.conn(), sid).unwrap().unwrap();
        assert_eq!(row.current_stage, "I");
        assert!(row.collapsed);
    }
    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert(
            db.conn(),
            &NewWorkmap {
                session_id: sid,
                current_stage: "D".into(),
                collapsed: false,
            },
        )
        .unwrap();
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        update(
            db.conn(),
            sid,
            &NewWorkmap {
                session_id: sid,
                current_stage: "V".into(),
                collapsed: true,
            },
        )
        .unwrap();
        assert_eq!(
            get_by_id(db.conn(), sid).unwrap().unwrap().current_stage,
            "V"
        );
        delete(db.conn(), sid).unwrap();
        assert!(get(db.conn(), sid).unwrap().is_none());
    }
}
