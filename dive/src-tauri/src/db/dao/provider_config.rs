use crate::db::dao::{json_to_string, parse_json};
use crate::db::models::{NewProviderConfig, ProviderConfigRow};
use crate::db::DbError;
use rusqlite::{params, Connection, OptionalExtension};
fn map_row(row: &rusqlite::Row<'_>) -> Result<ProviderConfigRow, DbError> {
    Ok(ProviderConfigRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        auth_type: row.get(2)?,
        base_url: row.get(3)?,
        config: parse_json(row.get(4)?)?,
    })
}
fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderConfigRow> {
    map_row(row).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
    })
}
pub fn insert(conn: &Connection, row: &NewProviderConfig) -> Result<i64, DbError> {
    let config = json_to_string(&row.config)?;
    conn.execute(
        "INSERT INTO ProviderConfig(kind, auth_type, base_url, config) VALUES (?, ?, ?, ?)",
        params![row.kind, row.auth_type, row.base_url, config],
    )?;
    Ok(conn.last_insert_rowid())
}
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<ProviderConfigRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, kind, auth_type, base_url, config FROM ProviderConfig WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}
pub fn list(conn: &Connection) -> Result<Vec<ProviderConfigRow>, DbError> {
    let mut stmt = conn
        .prepare("SELECT id, kind, auth_type, base_url, config FROM ProviderConfig ORDER BY id")?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub fn update(conn: &Connection, id: i64, row: &NewProviderConfig) -> Result<(), DbError> {
    let config = json_to_string(&row.config)?;
    conn.execute(
        "UPDATE ProviderConfig SET kind = ?, auth_type = ?, base_url = ?, config = ? WHERE id = ?",
        params![row.kind, row.auth_type, row.base_url, config, id],
    )?;
    Ok(())
}
pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM ProviderConfig WHERE id = ?", [id])?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::fresh_db;
    use serde_json::json;
    fn pc(kind: &str) -> NewProviderConfig {
        NewProviderConfig {
            kind: kind.into(),
            auth_type: "api_key".into(),
            base_url: Some("https://example.test".into()),
            config: json!({"models":["a"]}),
        }
    }
    #[test]
    fn crud_roundtrip_json() {
        let (db, _) = fresh_db();
        let id = insert(db.conn(), &pc("openai")).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().config,
            json!({"models":["a"]})
        );
        update(db.conn(), id, &pc("anthropic")).unwrap();
        assert_eq!(list(db.conn()).unwrap()[0].kind, "anthropic");
        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }
    #[test]
    fn invalid_auth_type_fails_check() {
        let (db, _) = fresh_db();
        let mut row = pc("openai");
        row.auth_type = "password".into();
        assert!(insert(db.conn(), &row).is_err());
    }
}
