pub mod artifacts;

use std::path::Path;

use rusqlite::Connection;

use crate::db::dao::{plan as plan_dao, step as step_dao};
use crate::db::DbError;

pub fn approve_plan_and_export(
    conn: &Connection,
    plan_id: i64,
    project_root: &Path,
) -> Result<(), DbError> {
    step_dao::validate_dependencies(conn, plan_id)?;
    plan_dao::approve(conn, plan_id)?;
    artifacts::export_plan_artifacts(conn, plan_id, project_root)
}
