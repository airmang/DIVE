pub mod card;
pub mod checkpoint;
pub mod event_log;
pub mod interview;
pub mod interview_turn;
pub mod message;
pub mod plan;
pub mod plan_mutation;
pub mod prd;
pub mod project;
pub mod provider_config;
pub mod session;
pub mod step;
pub mod step_session_mapping;
pub mod tool_call;
pub mod workmap;

use serde_json::Value;

fn json_to_string(value: &Value) -> Result<String, crate::db::DbError> {
    Ok(serde_json::to_string(value)?)
}

fn optional_json_to_string(value: Option<&Value>) -> Result<Option<String>, crate::db::DbError> {
    value.map(json_to_string).transpose()
}

fn parse_json(value: String) -> Result<Value, crate::db::DbError> {
    Ok(serde_json::from_str(&value)?)
}

fn parse_optional_json(value: Option<String>) -> Result<Option<Value>, crate::db::DbError> {
    value
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(Into::into)
}
