use crate::db::models::ArchitectureForm;

#[derive(Debug, Clone, Copy)]
pub struct PlanFormStep<'a> {
    pub title: &'a str,
    pub summary: &'a str,
    pub instruction_seed: &'a str,
    pub expected_files: &'a [String],
}

pub fn form_consistency_annotation(
    form: Option<ArchitectureForm>,
    step: PlanFormStep<'_>,
) -> Option<String> {
    let form = form?;
    if form == ArchitectureForm::Other || step.expected_files.is_empty() {
        return None;
    }
    let text = normalize_step_text(step);
    match form {
        ArchitectureForm::WebApp if has_cli_only_contradiction(&text) => {
            Some("web_app step looks like a CLI-only implementation".into())
        }
        ArchitectureForm::StaticPage if has_backend_service_contradiction(&text) => {
            Some("static_page step includes backend/server/database markers".into())
        }
        ArchitectureForm::CliTool if has_browser_ui_contradiction(&text) => {
            Some("cli_tool step includes browser UI/DOM markers".into())
        }
        ArchitectureForm::DesktopApp if has_api_service_only_contradiction(&text) => {
            Some("desktop_app step looks like an API-service-only endpoint task".into())
        }
        ArchitectureForm::ApiService if has_browser_ui_contradiction(&text) => {
            Some("api_service step includes browser UI/DOM markers".into())
        }
        _ => None,
    }
}

fn normalize_step_text(step: PlanFormStep<'_>) -> String {
    [
        step.title,
        step.summary,
        step.instruction_seed,
        &step.expected_files.join("\n"),
    ]
    .join("\n")
    .to_lowercase()
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn has_cli_only_contradiction(text: &str) -> bool {
    contains_any(text, CLI_MARKERS) && contains_any(text, CLI_FILE_MARKERS)
}

fn has_backend_service_contradiction(text: &str) -> bool {
    contains_any(text, BACKEND_SERVICE_MARKERS) && contains_any(text, BACKEND_FILE_MARKERS)
}

fn has_browser_ui_contradiction(text: &str) -> bool {
    contains_any(text, BROWSER_UI_MARKERS) && contains_any(text, BROWSER_UI_FILE_MARKERS)
}

fn has_api_service_only_contradiction(text: &str) -> bool {
    contains_any(text, API_SERVICE_MARKERS) && contains_any(text, BACKEND_FILE_MARKERS)
}

const CLI_MARKERS: &[&str] = &[
    "cli",
    "command-line",
    "command line",
    "terminal command",
    "parse args",
    "argv",
    "stdin",
    "stdout",
];

const CLI_FILE_MARKERS: &[&str] = &["src/cli", "cli.ts", "cli.js", "main.rs", "clap"];

const BACKEND_SERVICE_MARKERS: &[&str] = &[
    "backend",
    "server",
    "database",
    "db migration",
    "sqlite",
    "postgres",
    "prisma",
    "auth backend",
    "api endpoint",
    "rest endpoint",
    "http route",
];

const BACKEND_FILE_MARKERS: &[&str] = &[
    "server.ts",
    "server.js",
    "routes/",
    "api/",
    "controllers/",
    "schema.prisma",
    "migrations/",
];

const BROWSER_UI_MARKERS: &[&str] = &[
    "browser",
    "dom",
    "react component",
    "ui component",
    "web page",
    "html page",
    "button",
    "form field",
];

const BROWSER_UI_FILE_MARKERS: &[&str] = &[
    "index.html",
    ".html",
    "app.tsx",
    "app.jsx",
    ".tsx",
    ".jsx",
    "components/",
    "styles.css",
];

const API_SERVICE_MARKERS: &[&str] = &[
    "api endpoint",
    "rest api",
    "http route",
    "request schema",
    "response schema",
    "openapi",
    "controller",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn annotation(
        form: Option<ArchitectureForm>,
        title: &str,
        summary: &str,
        instruction_seed: &str,
        expected_files: &[&str],
    ) -> Option<String> {
        let expected_files = expected_files
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        form_consistency_annotation(
            form,
            PlanFormStep {
                title,
                summary,
                instruction_seed,
                expected_files: &expected_files,
            },
        )
    }

    #[test]
    fn annotation_is_deterministic_for_same_input() {
        let first = annotation(
            Some(ArchitectureForm::CliTool),
            "Build browser UI",
            "Create a DOM page.",
            "Implement a React component for the browser.",
            &["src/App.tsx"],
        );
        let second = annotation(
            Some(ArchitectureForm::CliTool),
            "Build browser UI",
            "Create a DOM page.",
            "Implement a React component for the browser.",
            &["src/App.tsx"],
        );
        assert_eq!(first, second);
    }

    #[test]
    fn clear_contradictions_flag_for_bounded_forms() {
        let cases = [
            (
                ArchitectureForm::WebApp,
                "Build command-line interface",
                "Parse args and print stdout.",
                "Implement the CLI entrypoint.",
                &["src/cli.ts"][..],
            ),
            (
                ArchitectureForm::StaticPage,
                "Set up database server",
                "Add a backend database migration.",
                "Implement an Express server route.",
                &["server.ts", "migrations/001.sql"][..],
            ),
            (
                ArchitectureForm::CliTool,
                "Build browser UI",
                "Create a DOM page.",
                "Implement a React component for the browser.",
                &["src/App.tsx"][..],
            ),
            (
                ArchitectureForm::DesktopApp,
                "Create REST API endpoint",
                "Add request schema and controller.",
                "Implement the API endpoint.",
                &["src/routes/todos.ts"][..],
            ),
            (
                ArchitectureForm::ApiService,
                "Build browser form",
                "Create a DOM form field.",
                "Implement the React component.",
                &["src/components/LoginForm.tsx"][..],
            ),
        ];

        for (form, title, summary, instruction_seed, expected_files) in cases {
            assert!(
                annotation(Some(form), title, summary, instruction_seed, expected_files).is_some(),
                "expected {form:?} contradiction to flag"
            );
        }
    }

    #[test]
    fn consistent_steps_are_silent_for_each_form() {
        let cases = [
            (
                ArchitectureForm::WebApp,
                "Build React screen",
                "Render schedule items in the browser.",
                "Update the App component.",
                &["src/App.tsx"][..],
            ),
            (
                ArchitectureForm::StaticPage,
                "Create static page",
                "Add HTML and CSS.",
                "Implement index markup.",
                &["index.html", "styles.css"][..],
            ),
            (
                ArchitectureForm::CliTool,
                "Parse command args",
                "Read argv and print stdout.",
                "Implement the CLI command.",
                &["src/cli.ts"][..],
            ),
            (
                ArchitectureForm::DesktopApp,
                "Create desktop window",
                "Wire the Tauri shell.",
                "Implement the local app window.",
                &["src-tauri/src/main.rs", "src/App.tsx"][..],
            ),
            (
                ArchitectureForm::ApiService,
                "Create todos endpoint",
                "Add request and response schema validation.",
                "Implement the API route.",
                &["src/routes/todos.ts"][..],
            ),
            (
                ArchitectureForm::Other,
                "Describe custom build",
                "Keep it bounded.",
                "Implement the chosen form.",
                &["plan.md"][..],
            ),
        ];

        for (form, title, summary, instruction_seed, expected_files) in cases {
            assert_eq!(
                annotation(Some(form), title, summary, instruction_seed, expected_files),
                None,
                "expected {form:?} consistent step to stay silent"
            );
        }
    }

    #[test]
    fn edge_cases_are_silent_and_do_not_panic() {
        assert_eq!(
            annotation(
                Some(ArchitectureForm::CliTool),
                "Build browser UI",
                "Create a DOM page.",
                "Implement the React component.",
                &[],
            ),
            None
        );
        assert_eq!(
            annotation(
                None,
                "Build browser UI",
                "Create a DOM page.",
                "Implement the React component.",
                &["src/App.tsx"],
            ),
            None
        );
        assert_eq!(
            annotation(
                Some(ArchitectureForm::Other),
                "Build browser UI",
                "Create a DOM page.",
                "Implement the React component.",
                &["src/App.tsx"],
            ),
            None
        );
    }
}
