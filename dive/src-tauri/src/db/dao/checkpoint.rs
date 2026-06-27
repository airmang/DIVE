use crate::db::models::{CheckpointRow, CheckpointStats, NewCheckpoint};
use crate::db::{now_ms, DbError};
use rusqlite::{params, Connection, OptionalExtension};

fn parse_changed_files(raw: String) -> Result<Vec<String>, DbError> {
    Ok(serde_json::from_str(&raw)?)
}

fn parse_stats(raw: String) -> Result<CheckpointStats, DbError> {
    Ok(serde_json::from_str(&raw)?)
}

fn map_row(row: &rusqlite::Row<'_>) -> Result<CheckpointRow, DbError> {
    Ok(CheckpointRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        card_id: row.get(2)?,
        git_sha: row.get(3)?,
        kind: row.get(4)?,
        label: row.get(5)?,
        created_at: row.get(6)?,
        changed_files: parse_changed_files(row.get(7)?)?,
        stats: parse_stats(row.get(8)?)?,
        session_state_snapshot: row.get(9)?,
    })
}

fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CheckpointRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewCheckpoint) -> Result<i64, DbError> {
    let changed_files = serde_json::to_string(&row.changed_files)?;
    let stats = serde_json::to_string(&row.stats)?;
    conn.execute(
        "INSERT INTO Checkpoint(session_id, card_id, git_sha, kind, label, changed_files, stats, session_state_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![row.session_id,row.card_id,row.git_sha,row.kind,row.label,changed_files,stats,row.session_state_snapshot,now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<CheckpointRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, session_id, card_id, git_sha, kind, label, created_at, changed_files, stats, session_state_snapshot FROM Checkpoint WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<CheckpointRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, card_id, git_sha, kind, label, created_at, changed_files, stats, session_state_snapshot FROM Checkpoint ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn list_by_session(conn: &Connection, session_id: i64) -> Result<Vec<CheckpointRow>, DbError> {
    let mut stmt=conn.prepare("SELECT id, session_id, card_id, git_sha, kind, label, created_at, changed_files, stats, session_state_snapshot FROM Checkpoint WHERE session_id = ? ORDER BY created_at, id")?;
    let rows = stmt
        .query_map([session_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewCheckpoint) -> Result<(), DbError> {
    let changed_files = serde_json::to_string(&row.changed_files)?;
    let stats = serde_json::to_string(&row.stats)?;
    conn.execute("UPDATE Checkpoint SET session_id = ?, card_id = ?, git_sha = ?, kind = ?, label = ?, changed_files = ?, stats = ?, session_state_snapshot = ? WHERE id = ?",params![row.session_id,row.card_id,row.git_sha,row.kind,row.label,changed_files,stats,row.session_state_snapshot,id])?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Checkpoint WHERE id = ?", [id])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project_session};
    fn cp(sid: i64, sha: &str) -> NewCheckpoint {
        NewCheckpoint {
            session_id: sid,
            card_id: None,
            git_sha: sha.into(),
            kind: "auto".into(),
            label: Some("l".into()),
            changed_files: Vec::new(),
            stats: CheckpointStats::zero(),
            session_state_snapshot: None,
        }
    }
    #[test]
    fn crud_roundtrip_and_list_by_session() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let id = insert(db.conn(), &cp(sid, "a")).unwrap();
        assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().git_sha, "a");
        update(db.conn(), id, &cp(sid, "b")).unwrap();
        assert_eq!(list_by_session(db.conn(), sid).unwrap()[0].git_sha, "b");
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn invalid_kind_fails_check() {
        let (db, _) = fresh_db();
        let (_, sid) = seed_project_session(db.conn());
        let mut row = cp(sid, "a");
        row.kind = "scheduled".into();
        assert!(insert(db.conn(), &row).is_err());
    }
}
