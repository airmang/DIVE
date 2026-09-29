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

pub fn set_bool(conn: &Connection, key: &str, value: bool) -> Result<(), DbError> {
    set(conn, key, if value { "true" } else { "false" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::fresh_db;

    #[test]
    fn preference_round_trips_and_upserts() {
        let (db, _tmp) = fresh_db();
        assert_eq!(get(db.conn(), REPLAY_CAPTURE_KEY).unwrap(), None);
        set_bool(db.conn(), REPLAY_CAPTURE_KEY, false).unwrap();
        assert_eq!(
            get(db.conn(), REPLAY_CAPTURE_KEY).unwrap().as_deref(),
            Some("false")
        );
        set_bool(db.conn(), REPLAY_CAPTURE_KEY, true).unwrap();
        assert_eq!(
            get(db.conn(), REPLAY_CAPTURE_KEY).unwrap().as_deref(),
            Some("true")
        );
    }
}
