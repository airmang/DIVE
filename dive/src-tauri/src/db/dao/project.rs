use rusqlite::{params, Connection, OptionalExtension};

use crate::db::models::{NewProject, ProjectRow};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        provider_default: row.get(3)?,
        model_default: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn insert(conn: &Connection, row: &NewProject) -> Result<i64, DbError> {
    let now = now_ms();
    conn.execute("INSERT INTO Project(name, path, provider_default, model_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", params![row.name, row.path, row.provider_default, row.model_default, now, now])?;
    Ok(conn.last_insert_rowid())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<ProjectRow>, DbError> {
    Ok(conn.query_row("SELECT id, name, path, provider_default, model_default, created_at, updated_at FROM Project WHERE id = ?", [id], map_row).optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<ProjectRow>, DbError> {
    let mut stmt = conn.prepare("SELECT id, name, path, provider_default, model_default, created_at, updated_at FROM Project ORDER BY id")?;
    let rows = stmt
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_recent(conn: &Connection, limit: i64) -> Result<Vec<ProjectRow>, DbError> {
    let mut stmt = conn.prepare("SELECT id, name, path, provider_default, model_default, created_at, updated_at FROM Project ORDER BY updated_at DESC, id DESC LIMIT ?")?;
    let rows = stmt
        .query_map([limit], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn touch(conn: &Connection, id: i64) -> Result<(), DbError> {
    let now = now_ms();
    conn.execute(
        "UPDATE Project SET updated_at = CASE WHEN updated_at >= ? THEN updated_at + 1 ELSE ? END WHERE id = ?",
        params![now, now, id],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, row: &NewProject) -> Result<(), DbError> {
    conn.execute("UPDATE Project SET name = ?, path = ?, provider_default = ?, model_default = ?, updated_at = ? WHERE id = ?", params![row.name, row.path, row.provider_default, row.model_default, now_ms(), id])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Project WHERE id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::fresh_db;

    fn new_project(name: &str, path: &str) -> NewProject {
        NewProject {
            name: name.into(),
            path: path.into(),
            provider_default: Some("openai".into()),
            model_default: Some("gpt".into()),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let id = insert(db.conn(), &new_project("a", "/tmp/a")).unwrap();
        assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().name, "a");
        update(db.conn(), id, &new_project("b", "/tmp/b")).unwrap();
        assert_eq!(list(db.conn()).unwrap().len(), 1);
        assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().path, "/tmp/b");
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn missing_project_returns_none() {
        let (db, _tmp) = fresh_db();
        assert!(get_by_id(db.conn(), 404).unwrap().is_none());
    }

    #[test]
    fn list_recent_orders_by_updated_at_desc() {
        let (db, _tmp) = fresh_db();
        let first = insert(db.conn(), &new_project("first", "/tmp/first")).unwrap();
        let second = insert(db.conn(), &new_project("second", "/tmp/second")).unwrap();
        touch(db.conn(), first).unwrap();
        let recent = list_recent(db.conn(), 1).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, first);
        assert_ne!(recent[0].id, second);
    }
}
