use crate::db::dao::{json_to_string, parse_json};
use crate::db::models::{EventLogRow, NewEventLog};
use crate::db::{now_ms, DbError};
use rusqlite::{params, Connection, OptionalExtension};
fn map_row(row: &rusqlite::Row<'_>) -> Result<EventLogRow, DbError> {
    Ok(EventLogRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        r#type: row.get(2)?,
        payload: parse_json(row.get(3)?)?,
        created_at: row.get(4)?,
    })
}
fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventLogRow> {
    map_row(row).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })
}
pub fn append(conn: &Connection, row: &NewEventLog) -> Result<i64, DbError> {
    insert(conn, row)
}
pub fn insert(conn: &Connection, row: &NewEventLog) -> Result<i64, DbError> {
    let payload = json_to_string(&row.payload)?;
    conn.execute(
        "INSERT INTO EventLog(session_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
        params![row.session_id, row.r#type, payload, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<EventLogRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, session_id, type, payload, created_at FROM EventLog WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<EventLogRow>, DbError> {
    let mut stmt =
        conn.prepare("SELECT id, session_id, type, payload, created_at FROM EventLog ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn list_by_session(conn: &Connection, session_id: i64) -> Result<Vec<EventLogRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, type, payload, created_at FROM EventLog WHERE session_id = ? ORDER BY created_at, id")?;
    let rows = stmt
        .query_map([session_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewEventLog) -> Result<(), DbError> {
    let payload = json_to_string(&row.payload)?;
    conn.execute(
        "UPDATE EventLog SET session_id = ?, type = ?, payload = ? WHERE id = ?",
        params![row.session_id, row.r#type, payload, id],
    )?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM EventLog WHERE id = ?", [id])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;
    fn ev(sid: i64, t: &str) -> NewEventLog {
        NewEventLog {
            session_id: Some(sid),
            r#type: t.into(),
            payload: json!({"stage":"D"}),
        }
    }
    #[test]
    fn crud_append_json_and_list_by_session() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let id = append(db.conn(), &ev(sid, "stage_enter")).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().payload,
            json!({"stage":"D"})
        );
        update(db.conn(), id, &ev(sid, "stage_exit")).unwrap();
        assert_eq!(
            list_by_session(db.conn(), sid).unwrap()[0].r#type,
            "stage_exit"
        );
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn nullable_session_event_roundtrips() {
        let (db, _) = fresh_db();
        let id = append(
            db.conn(),
            &NewEventLog {
                session_id: None,
                r#type: "error_occurred".into(),
                payload: json!({}),
            },
        )
        .unwrap();
        assert!(get_by_id(db.conn(), id)
            .unwrap()
            .unwrap()
            .session_id
            .is_none());
    }
}
