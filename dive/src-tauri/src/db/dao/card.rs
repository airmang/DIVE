use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{CardRow, CardState, NewCard};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> Result<CardRow, DbError> {
    Ok(CardRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        title: row.get(2)?,
        instruction: row.get(3)?,
        assist_summary: row.get(4)?,
        acceptance_criteria: row.get(5)?,
        retrospective: row.get(6)?,
        change_summary: row.get(7)?,
        state: row.get(8)?,
        verify_log: row.get(9)?,
        changed_files: parse_optional_json(row.get(10)?)?,
        test_command: row.get(11)?,
        position: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        approval_judgment: row.get(15)?,
    })
}
fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewCard) -> Result<i64, DbError> {
    let now = now_ms();
    let changed_files = optional_json_to_string(row.changed_files.as_ref())?;
    conn.execute("INSERT INTO Card(session_id, title, instruction, assist_summary, acceptance_criteria, retrospective, change_summary, state, verify_log, changed_files, test_command, position, approval_judgment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params![row.session_id,row.title,row.instruction,row.assist_summary,row.acceptance_criteria,row.retrospective,row.change_summary,row.state,row.verify_log,changed_files,row.test_command,row.position,row.approval_judgment,now,now])?;
    Ok(conn.last_insert_rowid())
}

pub fn next_position(conn: &Connection, session_id: i64) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM Card WHERE session_id = ?",
        [session_id],
        |row| row.get(0),
    )?)
}

pub fn create(
    conn: &Connection,
    session_id: i64,
    title: &str,
    position: Option<i64>,
) -> Result<CardRow, DbError> {
    let id = insert(
        conn,
        &NewCard {
            session_id,
            title: title.trim().to_owned(),
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
            position: position.unwrap_or(next_position(conn, session_id)?),
        },
    )?;
    Ok(get_by_id(conn, id)?.expect("inserted card should be readable"))
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<CardRow>, DbError> {
    Ok(conn.query_row("SELECT id, session_id, title, instruction, assist_summary, acceptance_criteria, retrospective, change_summary, state, verify_log, changed_files, test_command, position, created_at, updated_at, approval_judgment FROM Card WHERE id = ?", [id], query_map_row).optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<CardRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, title, instruction, assist_summary, acceptance_criteria, retrospective, change_summary, state, verify_log, changed_files, test_command, position, created_at, updated_at, approval_judgment FROM Card ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn list_by_session(conn: &Connection, session_id: i64) -> Result<Vec<CardRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, title, instruction, assist_summary, acceptance_criteria, retrospective, change_summary, state, verify_log, changed_files, test_command, position, created_at, updated_at, approval_judgment FROM Card WHERE session_id = ? ORDER BY position, id")?;
    let rows = stmt
        .query_map([session_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewCard) -> Result<(), DbError> {
    let changed_files = optional_json_to_string(row.changed_files.as_ref())?;
    conn.execute("UPDATE Card SET session_id = ?, title = ?, instruction = ?, assist_summary = ?, acceptance_criteria = ?, retrospective = ?, change_summary = ?, state = ?, verify_log = ?, changed_files = ?, test_command = ?, position = ?, approval_judgment = ?, updated_at = ? WHERE id = ?", params![row.session_id,row.title,row.instruction,row.assist_summary,row.acceptance_criteria,row.retrospective,row.change_summary,row.state,row.verify_log,changed_files,row.test_command,row.position,row.approval_judgment,now_ms(),id])?;
    Ok(())
}

pub fn append_changed_files(
    conn: &Connection,
    id: i64,
    paths: &[String],
) -> Result<Vec<String>, DbError> {
    let Some(existing) = get_by_id(conn, id)? else {
        return Ok(Vec::new());
    };
    let mut merged = existing
        .changed_files
        .as_ref()
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for path in paths {
        let normalized = path.trim().replace('\\', "/");
        if normalized.is_empty()
            || normalized.starts_with('/')
            || normalized.split('/').any(|part| part == "..")
        {
            continue;
        }
        if !merged.iter().any(|existing| existing == &normalized) {
            merged.push(normalized);
        }
    }
    let changed_files = serde_json::to_string(&merged)?;
    conn.execute(
        "UPDATE Card SET changed_files = ?, updated_at = ? WHERE id = ?",
        params![changed_files, now_ms(), id],
    )?;
    Ok(merged)
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Card WHERE id = ?", [id])?;
    Ok(())
}

pub fn delete_by_id(conn: &Connection, id: i64) -> Result<(), DbError> {
    delete(conn, id)
}

pub fn reorder(conn: &Connection, session_id: i64, ordered_ids: &[i64]) -> Result<(), DbError> {
    let existing = list_by_session(conn, session_id)?;
    if existing.len() != ordered_ids.len() {
        return Err(DbError::Sqlite(rusqlite::Error::InvalidQuery));
    }
    let existing_ids = existing
        .iter()
        .map(|c| c.id)
        .collect::<std::collections::HashSet<_>>();
    let ordered_set = ordered_ids
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    if existing_ids != ordered_set {
        return Err(DbError::Sqlite(rusqlite::Error::InvalidQuery));
    }
    for (idx, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE Card SET position = ?, updated_at = ? WHERE id = ? AND session_id = ?",
            params![idx as i64 + 1, now_ms(), id, session_id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CardState;
    use crate::db::tests::{fresh_db, seed_project_session};
    use serde_json::json;
    fn new_card(sid: i64, state: CardState, pos: i64) -> NewCard {
        NewCard {
            session_id: sid,
            title: format!("c{pos}"),
            instruction: Some("i".into()),
            assist_summary: None,
            acceptance_criteria: None,
            retrospective: None,
            change_summary: None,
            state,
            verify_log: None,
            changed_files: Some(json!(["a.rs"])),
            test_command: None,
            approval_judgment: None,
            position: pos,
        }
    }
    #[test]
    fn crud_roundtrip_and_list_by_session() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let id = insert(db.conn(), &new_card(sid, CardState::Decomposed, 2)).unwrap();
        insert(db.conn(), &new_card(sid, CardState::Verified, 1)).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().state,
            CardState::Decomposed
        );
        update(db.conn(), id, &new_card(sid, CardState::Rejected, 3)).unwrap();
        assert_eq!(list_by_session(db.conn(), sid).unwrap().len(), 2);
        assert_eq!(list(db.conn()).unwrap().len(), 2);
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn create_uses_next_position_and_reorder_rewrites_positions() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let first = create(db.conn(), sid, "first", None).unwrap();
        let second = create(db.conn(), sid, "second", None).unwrap();
        assert_eq!(first.position, 1);
        assert_eq!(second.position, 2);

        reorder(db.conn(), sid, &[second.id, first.id]).unwrap();
        let rows = list_by_session(db.conn(), sid).unwrap();
        assert_eq!(
            rows.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
        assert_eq!(
            rows.iter().map(|c| c.position).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }
    #[test]
    fn foreign_key_rejects_missing_session() {
        let (db, _) = fresh_db();
        let err = insert(db.conn(), &new_card(999, CardState::Decomposed, 1)).unwrap_err();
        assert!(matches!(
            err,
            DbError::Sqlite(rusqlite::Error::SqliteFailure(_, _))
        ));
    }
    #[test]
    fn card_state_roundtrips_all_variants() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let states = [
            CardState::Decomposed,
            CardState::Instructed,
            CardState::Verifying,
            CardState::Verified,
            CardState::Rejected,
            CardState::Extended,
        ];
        for (idx, state) in states.iter().enumerate() {
            let id = insert(db.conn(), &new_card(sid, *state, idx as i64)).unwrap();
            assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().state, *state);
        }
    }

    #[test]
    fn append_changed_files_dedupes_and_rejects_escapes() {
        let (db, _tmp) = fresh_db();
        let (_, session_id) = seed_project_session(db.conn());
        let id = insert(db.conn(), &new_card(session_id, CardState::Decomposed, 1)).unwrap();
        let merged = append_changed_files(
            db.conn(),
            id,
            &[
                "src/App.tsx".into(),
                "src\\App.tsx".into(),
                "../secret".into(),
                "/tmp/outside".into(),
            ],
        )
        .unwrap();
        assert_eq!(merged, vec!["a.rs", "src/App.tsx"]);
    }
}
