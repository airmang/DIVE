use std::time::Duration;

pub(crate) const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const PROVIDER_STREAM_CHUNK_TIMEOUT: Duration = Duration::from_secs(45);
pub(crate) const MCP_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn build_provider_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .build()
        .expect("provider HTTP client configuration should be valid")
}

pub(crate) fn build_mcp_http_client() -> reqwest::Client {
    build_http_client_with_request_timeout(MCP_HTTP_REQUEST_TIMEOUT)
        .expect("MCP HTTP client configuration should be valid")
}

pub(crate) fn build_http_client_with_request_timeout(
    timeout: Duration,
) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    #[tokio::test]
    async fn shared_http_client_maps_request_timeout_to_provider_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/slow"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(50))
                    .set_body_string("ok"),
            )
            .mount(&server)
            .await;

        let client = super::build_http_client_with_request_timeout(Duration::from_millis(1))
            .expect("test client");
        let err = client
            .get(format!("{}/slow", server.uri()))
            .send()
            .await
            .map_err(crate::providers::ProviderError::from)
            .unwrap_err();

        assert!(matches!(err, crate::providers::ProviderError::Timeout(_)));
        assert!(err.to_string().contains("timed out"));
    }
}
