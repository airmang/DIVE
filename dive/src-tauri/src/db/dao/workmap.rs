use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::{NewWorkmap, WorkmapRow};
use crate::db::DbError;

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkmapRow> {
    Ok(WorkmapRow {
        session_id: row.get(0)?,
        current_stage: row.get(1)?,
        collapsed: row.get(2)?,
        current_card_id: row.get(3)?,
    })
}
pub fn upsert(conn: &Connection, row: &NewWorkmap) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO Workmap(session_id, current_stage, collapsed, current_card_id) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET current_stage = excluded.current_stage, collapsed = excluded.collapsed, current_card_id = excluded.current_card_id",
        params![row.session_id, row.current_stage, row.collapsed, row.current_card_id],
    )?;
    Ok(())
}
pub fn insert(conn: &Connection, row: &NewWorkmap) -> Result<i64, DbError> {
    upsert(conn, row)?;
    Ok(row.session_id)
}
pub fn get(conn: &Connection, session_id: i64) -> Result<Option<WorkmapRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT session_id, current_stage, collapsed, current_card_id FROM Workmap WHERE session_id = ?",
            [session_id],
            map_row,
        )
        .optional()?)
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<WorkmapRow>, DbError> {
    get(conn, id)
}
pub fn list(conn: &Connection) -> Result<Vec<WorkmapRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT session_id, current_stage, collapsed, current_card_id FROM Workmap ORDER BY session_id",
    )?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewWorkmap) -> Result<(), DbError> {
    conn.execute(
        "UPDATE Workmap SET current_stage = ?, collapsed = ?, current_card_id = ? WHERE session_id = ?",
        params![row.current_stage, row.collapsed, row.current_card_id, id],
    )?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Workmap WHERE session_id = ?", [id])?;
    Ok(())
}

pub fn set_current_card(
    conn: &Connection,
    session_id: i64,
    card_id: Option<i64>,
) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO Workmap(session_id, current_stage, collapsed, current_card_id) VALUES (?, 'D', 0, ?) ON CONFLICT(session_id) DO UPDATE SET current_card_id = excluded.current_card_id",
        params![session_id, card_id],
    )?;
    Ok(())
}

pub fn set_current_stage(conn: &Connection, session_id: i64, stage: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO Workmap(session_id, current_stage, collapsed, current_card_id) VALUES (?, ?, 0, NULL) ON CONFLICT(session_id) DO UPDATE SET current_stage = excluded.current_stage",
        params![session_id, stage],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::card as card_dao;
    use crate::db::models::{CardState, NewCard};
    use crate::db::tests::{fresh_db, seed_project_session};

    fn new_workmap(sid: i64, stage: &str) -> NewWorkmap {
        NewWorkmap {
            session_id: sid,
            current_stage: stage.into(),
            collapsed: false,
            current_card_id: None,
        }
    }

    #[test]
    fn upsert_inserts_and_updates() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        upsert(db.conn(), &new_workmap(sid, "D")).unwrap();
        let row = get(db.conn(), sid).unwrap().unwrap();
        assert!(!row.collapsed);
        assert_eq!(row.current_card_id, None);
        upsert(
            db.conn(),
            &NewWorkmap {
                session_id: sid,
                current_stage: "I".into(),
                collapsed: true,
                current_card_id: None,
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
        insert(db.conn(), &new_workmap(sid, "D")).unwrap();
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        update(
            db.conn(),
            sid,
            &NewWorkmap {
                session_id: sid,
                current_stage: "V".into(),
                collapsed: true,
                current_card_id: None,
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

    #[test]
    fn set_current_card_creates_row_if_missing() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = card_dao::insert(
            db.conn(),
            &NewCard {
                session_id: sid,
                title: "c1".into(),
                instruction: None,
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: CardState::Decomposed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: 1,
            },
        )
        .unwrap();
        set_current_card(db.conn(), sid, Some(cid)).unwrap();
        let row = get(db.conn(), sid).unwrap().unwrap();
        assert_eq!(row.current_card_id, Some(cid));
        assert_eq!(row.current_stage, "D");
    }

    #[test]
    fn set_current_card_updates_existing_row() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        insert(db.conn(), &new_workmap(sid, "I")).unwrap();
        let cid = card_dao::insert(
            db.conn(),
            &NewCard {
                session_id: sid,
                title: "c1".into(),
                instruction: None,
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: CardState::Decomposed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: 1,
            },
        )
        .unwrap();
        set_current_card(db.conn(), sid, Some(cid)).unwrap();
        let row = get(db.conn(), sid).unwrap().unwrap();
        assert_eq!(row.current_card_id, Some(cid));
        assert_eq!(row.current_stage, "I");
        set_current_card(db.conn(), sid, None).unwrap();
        assert_eq!(get(db.conn(), sid).unwrap().unwrap().current_card_id, None);
    }

    #[test]
    fn deleting_card_nulls_current_card_id() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let cid = card_dao::insert(
            db.conn(),
            &NewCard {
                session_id: sid,
                title: "c1".into(),
                instruction: None,
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: CardState::Decomposed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: 1,
            },
        )
        .unwrap();
        set_current_card(db.conn(), sid, Some(cid)).unwrap();
        card_dao::delete(db.conn(), cid).unwrap();
        assert_eq!(get(db.conn(), sid).unwrap().unwrap().current_card_id, None);
    }

    #[test]
    fn set_current_stage_creates_row_if_missing() {
        let (db, _tmp) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        set_current_stage(db.conn(), sid, "V").unwrap();
        assert_eq!(get(db.conn(), sid).unwrap().unwrap().current_stage, "V");
    }
}
