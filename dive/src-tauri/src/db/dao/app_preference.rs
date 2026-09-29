//! Backend-honored app preferences (`AppPreference` key/value rows).

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{now_ms, DbError};

/// Spec 015 FR-021 / D-015-02: local replay capture switch, default ON.
pub const REPLAY_CAPTURE_KEY: &str = "replayCapture";

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    Ok(conn
        .query_row(
            "SELECT value FROM AppPreference WHERE key = ?",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO AppPreference(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_ms()],
    )?;
    Ok(())
}

pub fn get_bool(conn: &Connection, key: &str, default: bool) -> Result<bool, DbError> {
    Ok(match get(conn, key)?.as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    })
}

pub fn set_bool(conn: &Connection, key: &str, value: bool) -> Result<(), DbError> {
    set(conn, key, if value { "true" } else { "false" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::fresh_db;

    #[test]
    fn bool_preference_defaults_then_round_trips() {
        let (db, _tmp) = fresh_db();
        assert!(get_bool(db.conn(), REPLAY_CAPTURE_KEY, true).unwrap());
        set_bool(db.conn(), REPLAY_CAPTURE_KEY, false).unwrap();
        assert!(!get_bool(db.conn(), REPLAY_CAPTURE_KEY, true).unwrap());
        set_bool(db.conn(), REPLAY_CAPTURE_KEY, true).unwrap();
        assert!(get_bool(db.conn(), REPLAY_CAPTURE_KEY, false).unwrap());
        // An unreadable stored value falls back to the default.
        set(db.conn(), REPLAY_CAPTURE_KEY, "maybe").unwrap();
        assert!(get_bool(db.conn(), REPLAY_CAPTURE_KEY, true).unwrap());
    }
}
