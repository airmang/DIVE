use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{json_to_string, parse_json};
use crate::db::models::{
    LiveProjectSpecDraftRow, NewLiveProjectSpecDraft, NewProjectSpecVersion, ProjectSpec,
    ProjectSpecDraft, ProjectSpecVersionRow,
};
use crate::db::{now_ms, DbError};

fn map_version_row(row: &rusqlite::Row<'_>) -> Result<ProjectSpecVersionRow, DbError> {
    Ok(ProjectSpecVersionRow {
        id: row.get(0)?,
        project_spec_id: row.get(1)?,
        project_id: row.get(2)?,
        version: row.get(3)?,
        previous_version: row.get(4)?,
        snapshot: serde_json::from_value::<ProjectSpec>(parse_json(row.get(5)?)?)?,
        reason: row.get(6)?,
        delta_summary: parse_json(row.get(7)?)?,
        created_at: row.get(8)?,
    })
}

fn query_version_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectSpecVersionRow> {
    map_version_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn map_draft_row(row: &rusqlite::Row<'_>) -> Result<LiveProjectSpecDraftRow, DbError> {
    Ok(LiveProjectSpecDraftRow {
        draft_id: row.get(0)?,
        project_id: row.get(1)?,
        base_version: row.get(2)?,
        spec: serde_json::from_value::<ProjectSpecDraft>(parse_json(row.get(3)?)?)?,
        dirty_fields: serde_json::from_value(parse_json(row.get(4)?)?)?,
        student_edited_fields: serde_json::from_value(parse_json(row.get(5)?)?)?,
        last_patch_id: row.get(6)?,
        field_provenance: serde_json::from_value(parse_json(row.get(7)?)?)?,
        updated_at: row.get(8)?,
    })
}

fn query_draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LiveProjectSpecDraftRow> {
    map_draft_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert_version(conn: &Connection, row: &NewProjectSpecVersion) -> Result<i64, DbError> {
    let snapshot = json_to_string(&serde_json::to_value(&row.snapshot)?)?;
    let delta_summary = json_to_string(&row.delta_summary)?;
    conn.execute(
        "INSERT INTO ProjectSpecVersion(project_spec_id, project_id, version, previous_version, snapshot, reason, delta_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.project_spec_id,
            row.project_id,
            row.version,
            row.previous_version,
            snapshot,
            row.reason,
            delta_summary,
            now_ms(),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn latest_version(
    conn: &Connection,
    project_id: i64,
) -> Result<Option<ProjectSpecVersionRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_spec_id, project_id, version, previous_version, snapshot, reason, delta_summary, created_at FROM ProjectSpecVersion WHERE project_id = ? ORDER BY version DESC, id DESC LIMIT 1",
            [project_id],
            query_version_row,
        )
        .optional()?)
}

pub fn list_versions(
    conn: &Connection,
    project_id: i64,
) -> Result<Vec<ProjectSpecVersionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_spec_id, project_id, version, previous_version, snapshot, reason, delta_summary, created_at FROM ProjectSpecVersion WHERE project_id = ? ORDER BY version ASC, id ASC",
    )?;
    let rows = stmt
        .query_map([project_id], query_version_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn upsert_draft(conn: &Connection, row: &NewLiveProjectSpecDraft) -> Result<(), DbError> {
    let spec = json_to_string(&serde_json::to_value(&row.spec)?)?;
    let dirty_fields = json_to_string(&serde_json::to_value(&row.dirty_fields)?)?;
    let student_edited_fields = json_to_string(&serde_json::to_value(&row.student_edited_fields)?)?;
    let field_provenance = json_to_string(&serde_json::to_value(&row.field_provenance)?)?;
    conn.execute(
        "INSERT INTO LiveProjectSpecDraft(draft_id, project_id, base_version, spec, dirty_fields, student_edited_fields, last_patch_id, field_provenance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
             draft_id = excluded.draft_id,
             base_version = excluded.base_version,
             spec = excluded.spec,
             dirty_fields = excluded.dirty_fields,
             student_edited_fields = excluded.student_edited_fields,
             last_patch_id = excluded.last_patch_id,
             field_provenance = excluded.field_provenance,
             updated_at = excluded.updated_at",
        params![
            row.draft_id,
            row.project_id,
            row.base_version,
            spec,
            dirty_fields,
            student_edited_fields,
            row.last_patch_id,
            field_provenance,
            now_ms(),
        ],
    )?;
    Ok(())
}

pub fn get_draft(
    conn: &Connection,
    project_id: i64,
) -> Result<Option<LiveProjectSpecDraftRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT draft_id, project_id, base_version, spec, dirty_fields, student_edited_fields, last_patch_id, field_provenance, updated_at FROM LiveProjectSpecDraft WHERE project_id = ?",
            [project_id],
            query_draft_row,
        )
        .optional()?)
}

pub fn delete_draft(conn: &Connection, project_id: i64) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM LiveProjectSpecDraft WHERE project_id = ?",
        [project_id],
    )?;
    Ok(())
}
