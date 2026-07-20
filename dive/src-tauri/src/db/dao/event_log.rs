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
/// Plan-scoped activity events, newest first, capped at `limit` (S-069 G2).
/// Replaces the former full-`EventLog` scan + Rust-side filter that ran once
/// per project on every dashboard render. `type GLOB 'plan_*'` mirrors the old
/// `starts_with("plan_")` exactly (GLOB treats `_` literally, unlike LIKE), and
/// `json_extract(payload,'$.plan_id') = ?` mirrors the `as_i64()` plan-id match.
/// Ordering (`created_at DESC, id DESC`) matches the old post-filter sort, so
/// the returned rows are identical to the pre-optimization scan.
pub fn list_plan_events(
    conn: &Connection,
    plan_id: i64,
    limit: i64,
) -> Result<Vec<EventLogRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, type, payload, created_at FROM EventLog WHERE type GLOB 'plan_*' AND json_extract(payload, '$.plan_id') = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )?;
    let rows = stmt
        .query_map(params![plan_id, limit], query_map_row)?
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
    // S-069 G2: the scoped `list_plan_events` query must return exactly the rows
    // (and order) the former full-EventLog scan + Rust filter produced, across
    // wrong-plan, missing-plan-id, `plan`-but-not-`plan_`, non-plan-type-with-
    // plan-id, created_at ties, and every LIMIT.
    #[test]
    fn list_plan_events_matches_full_scan_filter() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let conn = db.conn();
        let plan_id = 42_i64;

        let seed: &[(&str, serde_json::Value, i64)] = &[
            (
                "plan_created",
                json!({"plan_id": plan_id, "message": "created"}),
                100,
            ),
            (
                "plan_step_done",
                json!({"plan_id": plan_id, "message": "done"}),
                300,
            ),
            (
                "plan_step_done",
                json!({"plan_id": plan_id, "message": "tie-a"}),
                200,
            ),
            // Same created_at as tie-a: id-desc tiebreak must decide.
            (
                "plan_step_done",
                json!({"plan_id": plan_id, "message": "tie-b"}),
                200,
            ),
            // Wrong plan id — excluded.
            (
                "plan_step_done",
                json!({"plan_id": 7, "message": "other"}),
                250,
            ),
            // plan_ type but no plan_id — excluded.
            ("plan_note", json!({"message": "no plan id"}), 260),
            // Starts with 'plan' but not 'plan_' — GLOB '_' is literal, excluded.
            (
                "planomatic",
                json!({"plan_id": plan_id, "message": "not underscore"}),
                270,
            ),
            // Non-plan type that happens to carry plan_id — excluded by type.
            (
                "chat_turn",
                json!({"plan_id": plan_id, "message": "non-plan type"}),
                280,
            ),
        ];
        for (t, payload, created_at) in seed {
            conn.execute(
                "INSERT INTO EventLog(session_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
                params![
                    Some(sid),
                    t,
                    serde_json::to_string(payload).unwrap(),
                    created_at
                ],
            )
            .unwrap();
        }

        fn reference(conn: &Connection, plan_id: i64, limit: i64) -> Vec<i64> {
            let mut rows = list(conn)
                .unwrap()
                .into_iter()
                .filter(|r| {
                    r.r#type.starts_with("plan_")
                        && r.payload.get("plan_id").and_then(|v| v.as_i64()) == Some(plan_id)
                })
                .collect::<Vec<_>>();
            rows.sort_by(|a, b| {
                b.created_at
                    .cmp(&a.created_at)
                    .then_with(|| b.id.cmp(&a.id))
            });
            rows.truncate(limit as usize);
            rows.into_iter().map(|r| r.id).collect()
        }

        for limit in [1_i64, 2, 3, 100] {
            let got: Vec<i64> = list_plan_events(conn, plan_id, limit)
                .unwrap()
                .into_iter()
                .map(|r| r.id)
                .collect();
            assert_eq!(got, reference(conn, plan_id, limit), "limit {limit}");
        }
        // Exactly the four plan_id==42 plan_ events, nothing else.
        assert_eq!(list_plan_events(conn, plan_id, 100).unwrap().len(), 4);
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
