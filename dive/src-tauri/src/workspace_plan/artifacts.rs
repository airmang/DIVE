use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::dao::{plan as plan_dao, plan_mutation, prd, step as step_dao};
use crate::db::models::{
    LiveProjectSpecDraftRow, ObjectionRow, PlanMutationRow, PlanRow, ProjectSpec,
    ProjectSpecVersionRow, StepRow,
};
use crate::db::DbError;

const ARTIFACT_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanArtifact {
    pub schema_version: i32,
    pub status: String,
    pub goal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub non_goals: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_spec: Option<ProjectSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_spec_versions: Vec<ProjectSpecVersionRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_project_spec_draft: Option<LiveProjectSpecDraftRow>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plan_mutations: Vec<PlanMutationRow>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub objections: Vec<ObjectionRow>,
    pub steps: Vec<StepArtifact>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepArtifact {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction_seed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_files: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub linked_criterion_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decomposition_rationale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<VerificationArtifact>,
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_group: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationArtifact {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_check: Option<String>,
}

pub fn export_plan_artifacts(
    conn: &Connection,
    plan_id: i64,
    project_root: &Path,
) -> Result<(), DbError> {
    let plan = plan_dao::get_by_id(conn, plan_id)?
        .ok_or_else(|| DbError::Sqlite(rusqlite::Error::InvalidQuery))?;
    let steps = step_dao::list_by_plan(conn, plan_id)?;
    let dive_dir = project_root.join(".dive");
    std::fs::create_dir_all(&dive_dir)?;

    let artifact = build_plan_artifact(conn, &plan, &steps)?;
    std::fs::write(
        dive_dir.join("plan.json"),
        serde_json::to_string_pretty(&artifact)?,
    )?;
    std::fs::write(dive_dir.join("plan.md"), build_plan_markdown(&plan, &steps))?;
    std::fs::write(dive_dir.join("flow.mmd"), build_flow_mermaid(&steps))?;
    Ok(())
}

fn build_plan_artifact(
    conn: &Connection,
    plan: &PlanRow,
    steps: &[StepRow],
) -> Result<PlanArtifact, DbError> {
    let project_spec_versions = prd::list_versions(conn, plan.project_id)?;
    let project_spec = project_spec_versions
        .last()
        .map(|version| version.snapshot.clone());
    Ok(PlanArtifact {
        schema_version: ARTIFACT_SCHEMA_VERSION,
        status: plan.status.clone(),
        goal: plan.goal.clone(),
        intent_summary: plan.intent_summary.clone(),
        scope: plan.scope.clone(),
        non_goals: plan.non_goals.clone(),
        constraints: plan.constraints.clone(),
        acceptance_criteria: plan.acceptance_criteria.clone(),
        project_spec,
        project_spec_versions,
        live_project_spec_draft: prd::get_draft(conn, plan.project_id)?,
        plan_mutations: plan_mutation::list_mutations_by_plan(conn, plan.id)?,
        objections: plan_mutation::list_objections_by_plan(conn, plan.id)?,
        steps: steps.iter().map(build_step_artifact).collect(),
        created_at: plan.created_at,
        approved_at: plan.approved_at,
    })
}

fn build_step_artifact(step: &StepRow) -> StepArtifact {
    StepArtifact {
        id: step.step_id.clone(),
        title: step.title.clone(),
        summary: step.summary.clone(),
        instruction_seed: step.instruction_seed.clone(),
        expected_files: step.expected_files.clone(),
        acceptance_criteria: step.acceptance_criteria.clone(),
        linked_criterion_ids: linked_criterion_ids(step.acceptance_criteria.as_ref()),
        decomposition_rationale: decomposition_rationale(step.acceptance_criteria.as_ref()),
        verification: step
            .verification_kind
            .as_ref()
            .map(|kind| VerificationArtifact {
                kind: kind.clone(),
                command: step.verification_command.clone(),
                manual_check: step.verification_manual_check.clone(),
            }),
        dependencies: string_array(step.dependencies.as_ref()),
        parallel_group: step.parallel_group.clone(),
    }
}

fn build_plan_markdown(plan: &PlanRow, steps: &[StepRow]) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {}\n\n", plan.goal));
    if let Some(summary) = &plan.intent_summary {
        md.push_str(summary);
        md.push_str("\n\n");
    }
    append_array_section(&mut md, "Scope", plan.scope.as_ref(), false);
    append_array_section(&mut md, "Non-Goals", plan.non_goals.as_ref(), false);
    append_array_section(&mut md, "Constraints", plan.constraints.as_ref(), false);
    append_array_section(
        &mut md,
        "Acceptance Criteria",
        plan.acceptance_criteria.as_ref(),
        false,
    );

    md.push_str("## Steps\n\n");
    for (index, step) in steps.iter().enumerate() {
        md.push_str(&format!("### {}. {}\n\n", index + 1, step.title));
        if let Some(summary) = &step.summary {
            md.push_str(summary);
            md.push_str("\n\n");
        }
        if let Some(instruction) = &step.instruction_seed {
            md.push_str(&format!("**Instruction:** {}\n\n", instruction));
        }
        append_array_section(
            &mut md,
            "Expected Files",
            step.expected_files.as_ref(),
            true,
        );
        append_array_section(
            &mut md,
            "Acceptance Criteria",
            step.acceptance_criteria.as_ref(),
            false,
        );
        if let Some(kind) = &step.verification_kind {
            md.push_str(&format!("**Verification:** {}\n", kind));
            if let Some(command) = &step.verification_command {
                md.push_str(&format!("- Command: `{}`\n", command));
            }
            if let Some(check) = &step.verification_manual_check {
                md.push_str(&format!("- Manual Check: {}\n", check));
            }
            md.push('\n');
        }
        append_array_section(&mut md, "Dependencies", step.dependencies.as_ref(), false);
        if let Some(group) = &step.parallel_group {
            md.push_str(&format!("**Parallel Group:** {}\n\n", group));
        }
    }
    md
}

fn append_array_section(md: &mut String, title: &str, value: Option<&Value>, code: bool) {
    let items = string_array(value);
    if items.is_empty() {
        return;
    }
    md.push_str(&format!("## {}\n\n", title));
    for item in items {
        if code {
            md.push_str(&format!("- `{}`\n", item));
        } else {
            md.push_str(&format!("- {}\n", item));
        }
    }
    md.push('\n');
}

fn build_flow_mermaid(steps: &[StepRow]) -> String {
    let mut flow = String::from("flowchart TD\n");
    for step in steps {
        flow.push_str(&format!(
            "  {}[\"{}\"]\n",
            mermaid_id(&step.step_id),
            escape_mermaid_label(&step.title)
        ));
    }
    for step in steps {
        for dep in string_array(step.dependencies.as_ref()) {
            flow.push_str(&format!(
                "  {} --> {}\n",
                mermaid_id(&dep),
                mermaid_id(&step.step_id)
            ));
        }
    }
    flow
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn linked_criterion_ids(value: Option<&Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_linked_criterion_ids(value, &mut out);
    out
}

fn collect_linked_criterion_ids(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_linked_criterion_ids(item, out);
            }
        }
        Value::Object(map) => {
            if let Some(id) = map
                .get("criterionId")
                .or_else(|| map.get("criterion_id"))
                .and_then(Value::as_str)
            {
                push_unique(out, id);
            }
            for key in ["linkedCriterionIds", "linked_criterion_ids"] {
                if let Some(ids) = map.get(key).and_then(Value::as_array) {
                    for id in ids.iter().filter_map(Value::as_str) {
                        push_unique(out, id);
                    }
                }
            }
        }
        _ => {}
    }
}

fn decomposition_rationale(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(rationale) = value.get("rationale").and_then(Value::as_str) {
        let rationale = rationale.trim();
        if !rationale.is_empty() {
            return Some(rationale.to_owned());
        }
    }
    value.as_array()?.iter().find_map(|item| {
        item.get("rationale")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|rationale| !rationale.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn push_unique(out: &mut Vec<String>, value: &str) {
    if !out.iter().any(|existing| existing == value) {
        out.push(value.to_owned());
    }
}

fn mermaid_id(step_id: &str) -> String {
    step_id.replace('-', "_")
}

fn escape_mermaid_label(label: &str) -> String {
    label.replace('\\', "\\\\").replace('"', "\\\"")
}
