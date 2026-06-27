use std::io::Write;
use std::path::Path;

use dive_lib::ipc::preview::{
    preview_open_impl, validate_local_preview_url, validate_static_preview_target,
    PreviewOpenRequest, PreviewOpenStatus,
};
use dive_lib::ipc::AppState;
use dive_lib::tools::runtime::{PreviewRequestKind, PreviewRequestSource};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn request(kind: PreviewRequestKind, target: &str) -> PreviewOpenRequest {
    PreviewOpenRequest {
        session_id: Some(1),
        card_id: Some(7),
        kind,
        target: target.into(),
        source: PreviewRequestSource::ReviewAction,
        locale: None,
    }
}

fn write_package_json(root: &Path, script: &str) {
    std::fs::write(
        root.join("package.json"),
        format!(r#"{{"scripts":{{"dev":"{script}"}}}}"#),
    )
    .unwrap();
}

async fn spawn_one_shot_http_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = [0; 1024];
                let _ = socket.read(&mut buf).await;
                let _ = socket
                    .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
                    .await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}/"), handle)
}

#[test]
fn validates_static_html_targets_inside_project() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("index.html"), "<h1>DIVE</h1>").unwrap();

    let target = validate_static_preview_target(tmp.path(), "index.html").unwrap();

    assert_eq!(target.target_label, "index.html");
    assert!(target.asset_file_path.ends_with("index.html"));
}

#[test]
fn rejects_project_escape_and_non_html_static_targets() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("project");
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("index.html"), "<h1>outside</h1>").unwrap();
    std::fs::write(project.join("note.txt"), "not previewable").unwrap();

    let escape = validate_static_preview_target(&project, "../outside/index.html").unwrap_err();
    assert_eq!(escape.code, "project_escape");

    let extension = validate_static_preview_target(&project, "note.txt").unwrap_err();
    assert_eq!(extension.code, "unsupported_extension");
}

#[test]
fn rejects_missing_project_for_static_preview() {
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("missing");

    let err = validate_static_preview_target(&missing, "index.html").unwrap_err();

    assert_eq!(err.code, "missing_project");
}

#[test]
fn validates_loopback_urls_and_rejects_external_urls() {
    assert_eq!(
        validate_local_preview_url("http://localhost:5173/").unwrap(),
        "http://127.0.0.1:5173/"
    );
    assert!(validate_local_preview_url("https://127.0.0.1:4443/").is_ok());

    let external = validate_local_preview_url("https://example.com").unwrap_err();
    assert_eq!(external.code, "external_url");

    let unsupported = validate_local_preview_url("file:///tmp/index.html").unwrap_err();
    assert_eq!(unsupported.code, "unsupported_url");
}

#[tokio::test]
async fn opens_reachable_loopback_url_without_project_command() {
    let (url, _server) = spawn_one_shot_http_server().await;
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(&state, request(PreviewRequestKind::LocalUrl, &url))
        .await
        .unwrap();

    assert_eq!(result.status, PreviewOpenStatus::Ready);
    assert_eq!(result.preview_url.as_deref(), Some(url.as_str()));
    assert!(result.command_summary.is_none());
}

#[tokio::test]
async fn opens_static_html_through_project_scoped_http_server() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("index.html"),
        r#"<link rel="stylesheet" href="style.css"><h1>DIVE</h1>"#,
    )
    .unwrap();
    std::fs::write(tmp.path().join("style.css"), "body { background: black; }").unwrap();
    let state = AppState::dev_mock();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(
        &state,
        request(PreviewRequestKind::StaticFile, "index.html"),
    )
    .await
    .unwrap();

    assert_eq!(result.status, PreviewOpenStatus::Ready);
    let preview_url = result.preview_url.as_deref().unwrap();
    assert!(preview_url.starts_with("http://127.0.0.1:"));
    assert!(preview_url.ends_with("/index.html"));

    let css_url = preview_url.replace("index.html", "style.css");
    let css = reqwest::get(css_url).await.unwrap().text().await.unwrap();
    assert!(css.contains("background: black"));
}

#[tokio::test]
async fn static_server_serves_non_index_pages_and_json_data() {
    // S-031: the loopback preview server must serve arbitrary non-index project
    // pages and nested data files so the previewed page can navigate and fetch
    // real data same-origin (the parent webview CSP does not constrain the
    // iframe's own loopback origin).
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("index.html"), "<h1>home</h1>").unwrap();
    std::fs::write(tmp.path().join("about.html"), "<h1>about page</h1>").unwrap();
    std::fs::create_dir_all(tmp.path().join("data")).unwrap();
    std::fs::write(
        tmp.path().join("data/products.json"),
        r#"[{"name":"Pasta Bake"}]"#,
    )
    .unwrap();
    let state = AppState::dev_mock();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(
        &state,
        request(PreviewRequestKind::StaticFile, "index.html"),
    )
    .await
    .unwrap();
    let preview_url = result.preview_url.as_deref().unwrap();
    let base = preview_url.trim_end_matches("/index.html");

    // A non-index page renders.
    let about = reqwest::get(format!("{base}/about.html")).await.unwrap();
    assert_eq!(about.status(), 200);
    assert!(about.text().await.unwrap().contains("about page"));

    // A nested data file serves with a JSON content-type (so in-iframe fetch works).
    let json = reqwest::get(format!("{base}/data/products.json"))
        .await
        .unwrap();
    assert_eq!(json.status(), 200);
    assert_eq!(
        json.headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/json; charset=utf-8"),
    );
    assert!(json.text().await.unwrap().contains("Pasta Bake"));
}

#[tokio::test]
async fn reports_unreachable_loopback_url_as_preview_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://127.0.0.1:{}/",
        listener.local_addr().unwrap().port()
    );
    drop(listener);
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(&state, request(PreviewRequestKind::LocalUrl, &url))
        .await
        .unwrap();

    assert_eq!(result.status, PreviewOpenStatus::Failed);
    assert_eq!(result.reason_code.as_deref(), Some("local_url_unreachable"));
}

#[tokio::test]
async fn reuses_running_dev_server_from_project_preview_metadata() {
    let (url, _server) = spawn_one_shot_http_server().await;
    let port = reqwest::Url::parse(&url).unwrap().port().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    write_package_json(tmp.path(), &format!("vite --port {port}"));
    let state = AppState::dev_mock();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(&state, request(PreviewRequestKind::DevServer, ""))
        .await
        .unwrap();

    assert_eq!(result.status, PreviewOpenStatus::Ready);
    assert_eq!(
        result.preview_url.as_deref(),
        Some(url.trim_end_matches('/'))
    );
    assert!(result
        .command_summary
        .as_deref()
        .unwrap()
        .contains("npm run dev"));
}

#[tokio::test]
async fn reports_dev_server_startup_failure_as_preview_failure() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::File::create(tmp.path().join("package.json"))
        .unwrap()
        .write_all(br#"{"scripts":{"test":"vitest"}}"#)
        .unwrap();
    let state = AppState::dev_mock();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();

    let result = preview_open_impl(&state, request(PreviewRequestKind::DevServer, ""))
        .await
        .unwrap();

    assert_eq!(result.status, PreviewOpenStatus::Failed);
    assert_eq!(
        result.reason_code.as_deref(),
        Some("missing_dev_or_start_script")
    );
}
