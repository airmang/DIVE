use dive_lib::auth::OpenRouterProvisioning;
use serde_json::json;
use wiremock::matchers::{bearer_token, method, path, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn issue_child_key_roundtrip() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/keys"))
        .and(bearer_token("sk-main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "key": "sk-child-xyz",
                "hash": "abc123",
                "name": "class-a-period-1"
            }
        })))
        .mount(&server)
        .await;

    let prov = OpenRouterProvisioning::with_base_url(server.uri());
    let child = prov
        .issue_child_key("sk-main", "class-a-period-1", Some(5.0))
        .await
        .unwrap();
    assert_eq!(child.key, "sk-child-xyz");
    assert_eq!(child.hash, "abc123");
    assert_eq!(child.label, "class-a-period-1");
    assert_eq!(child.limit_usd, Some(5.0));
}

#[tokio::test]
async fn issue_propagates_remote_error_with_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/keys"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "bad main key" })))
        .mount(&server)
        .await;

    let prov = OpenRouterProvisioning::with_base_url(server.uri());
    let err = prov
        .issue_child_key("sk-bad", "lbl", None)
        .await
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("401"), "err should show status: {msg}");
    assert!(msg.contains("bad main key"), "err should show body: {msg}");
}

#[tokio::test]
async fn list_keys_returns_summaries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/keys"))
        .and(bearer_token("sk-main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                { "hash": "h1", "name": "class-a-p1", "limit": 5.0, "disabled": false },
                { "hash": "h2", "name": "class-a-p2", "limit": 5.0, "disabled": true },
                { "hash": "h3", "name": "other",    "limit": null, "disabled": false }
            ]
        })))
        .mount(&server)
        .await;

    let prov = OpenRouterProvisioning::with_base_url(server.uri());
    let items = prov.list_child_keys("sk-main").await.unwrap();
    assert_eq!(items.len(), 3);
    assert!(items.iter().any(|k| k.hash == "h1" && !k.disabled));
    assert!(items.iter().any(|k| k.hash == "h2" && k.disabled));
    assert!(items
        .iter()
        .any(|k| k.label == "other" && k.limit_usd.is_none()));
}

#[tokio::test]
async fn revoke_child_key_calls_delete() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path_regex(r"^/keys/h1$"))
        .and(bearer_token("sk-main"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let prov = OpenRouterProvisioning::with_base_url(server.uri());
    prov.revoke_child_key("sk-main", "h1").await.unwrap();
}

#[tokio::test]
async fn revoke_all_by_prefix_filters_and_skips_disabled() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/keys"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                { "hash": "h1", "name": "class-a-p1", "disabled": false },
                { "hash": "h2", "name": "class-a-p2", "disabled": true },
                { "hash": "h3", "name": "class-a-p3", "disabled": false },
                { "hash": "h4", "name": "class-b-p1", "disabled": false }
            ]
        })))
        .mount(&server)
        .await;

    Mock::given(method("DELETE"))
        .and(path_regex(r"^/keys/(h1|h3)$"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let prov = OpenRouterProvisioning::with_base_url(server.uri());
    let n = prov
        .revoke_all_by_prefix("sk-main", "class-a-")
        .await
        .unwrap();
    assert_eq!(
        n, 2,
        "must revoke h1 + h3, skip disabled h2 and out-of-prefix h4"
    );
}
