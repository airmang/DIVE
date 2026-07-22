use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(reqwest::Error),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("closed")]
    Closed,
    #[error("{0}")]
    Other(String),
}

impl From<reqwest::Error> for TransportError {
    fn from(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::Timeout(
                "MCP HTTP request timed out while waiting for a response; check the server and retry"
                    .into(),
            )
        } else {
            Self::Http(error)
        }
    }
}

#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, request: &[u8]) -> Result<Vec<u8>, TransportError>;
    fn kind(&self) -> TransportKind;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    Stdio,
    Http,
    Mock,
}

pub struct HttpTransport {
    endpoint: String,
    headers: HashMap<String, String>,
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            headers: HashMap::new(),
            client: crate::http_client::build_mcp_http_client(),
        }
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.insert(name.into(), value.into());
        self
    }

    pub fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.client = crate::http_client::build_http_client_with_request_timeout(timeout)
            .expect("MCP HTTP timeout configuration should be valid");
        self
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn send(&self, request: &[u8]) -> Result<Vec<u8>, TransportError> {
        let mut req = self
            .client
            .post(&self.endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json");
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req.body(request.to_vec()).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(TransportError::Other(format!("http {}: {}", status, body)));
        }
        Ok(resp.bytes().await?.to_vec())
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Http
    }
}

pub struct StdioTransport {
    child: Mutex<Option<tokio::process::Child>>,
    stdin: tokio::sync::Mutex<Option<tokio::process::ChildStdin>>,
    stdout: tokio::sync::Mutex<Option<tokio::io::BufReader<tokio::process::ChildStdout>>>,
    response_timeout: Duration,
}

impl StdioTransport {
    const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

    pub async fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self, TransportError> {
        Self::spawn_with_response_timeout(command, args, env, Self::DEFAULT_RESPONSE_TIMEOUT).await
    }

    pub async fn spawn_with_response_timeout(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
        response_timeout: Duration,
    ) -> Result<Self, TransportError> {
        use tokio::process::Command;
        let mut cmd = Command::new(command);
        cmd.args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| TransportError::Other("stdin not captured".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| TransportError::Other("stdout not captured".into()))?;
        Ok(Self {
            child: Mutex::new(Some(child)),
            stdin: tokio::sync::Mutex::new(Some(stdin)),
            stdout: tokio::sync::Mutex::new(Some(tokio::io::BufReader::new(stdout))),
            response_timeout,
        })
    }

    pub async fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.start_kill();
            }
        }
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&self, request: &[u8]) -> Result<Vec<u8>, TransportError> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let mut stdin_guard = self.stdin.lock().await;
        let stdin = stdin_guard.as_mut().ok_or(TransportError::Closed)?;
        stdin.write_all(request).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        drop(stdin_guard);

        let mut stdout_guard = self.stdout.lock().await;
        let stdout = stdout_guard.as_mut().ok_or(TransportError::Closed)?;
        let mut line = String::new();
        let n = tokio::time::timeout(self.response_timeout, stdout.read_line(&mut line))
            .await
            .map_err(|_| {
                TransportError::Timeout(format!(
                    "MCP stdio request timed out after {}s while waiting for a response line; check the server and retry",
                    self.response_timeout.as_secs()
                ))
            })??;
        if n == 0 {
            return Err(TransportError::Closed);
        }
        Ok(line.trim_end_matches(&['\r', '\n'][..]).as_bytes().to_vec())
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Stdio
    }
}

pub struct MockTransport {
    responses: tokio::sync::Mutex<std::collections::VecDeque<serde_json::Value>>,
}

impl MockTransport {
    pub fn new(responses: Vec<serde_json::Value>) -> Self {
        Self {
            responses: tokio::sync::Mutex::new(responses.into()),
        }
    }
}

#[async_trait]
impl Transport for MockTransport {
    async fn send(&self, _request: &[u8]) -> Result<Vec<u8>, TransportError> {
        let mut queue = self.responses.lock().await;
        let next = queue
            .pop_front()
            .ok_or_else(|| TransportError::Other("mock queue exhausted".into()))?;
        Ok(serde_json::to_vec(&next).map_err(|e| TransportError::Other(e.to_string()))?)
    }

    fn kind(&self) -> TransportKind {
        TransportKind::Mock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn http_transport_sends_and_receives() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/rpc"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"ok":true}"#))
            .mount(&server)
            .await;
        let t = HttpTransport::new(format!("{}/rpc", server.uri()));
        let bytes = t
            .send(br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#)
            .await
            .unwrap();
        assert_eq!(bytes, br#"{"ok":true}"#);
    }

    #[tokio::test]
    async fn http_transport_surfaces_error_status() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/rpc"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&server)
            .await;
        let t = HttpTransport::new(format!("{}/rpc", server.uri()));
        let err = t.send(b"{}").await.unwrap_err();
        assert!(matches!(err, TransportError::Other(_)));
    }

    #[tokio::test]
    async fn http_transport_adds_custom_headers() {
        let server = MockServer::start().await;
        use wiremock::matchers::header;
        Mock::given(method("POST"))
            .and(path("/rpc"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
            .mount(&server)
            .await;
        let t = HttpTransport::new(format!("{}/rpc", server.uri()))
            .with_header("x-api-key", "test-key");
        t.send(b"{}").await.unwrap();
    }

    #[tokio::test]
    async fn http_transport_times_out_waiting_for_response() {
        use std::time::Duration;

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/rpc"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_millis(50))
                    .set_body_string("{}"),
            )
            .mount(&server)
            .await;
        let t = HttpTransport::new(format!("{}/rpc", server.uri()))
            .with_request_timeout(Duration::from_millis(1));
        let err = t.send(b"{}").await.unwrap_err();
        assert!(matches!(err, TransportError::Timeout(_)));
        assert!(err.to_string().contains("MCP HTTP"));
    }

    #[tokio::test]
    async fn mock_transport_returns_queued_responses() {
        let t = MockTransport::new(vec![
            serde_json::json!({"a": 1}),
            serde_json::json!({"b": 2}),
        ]);
        let a = t.send(b"req1").await.unwrap();
        assert_eq!(a, br#"{"a":1}"#);
        let b = t.send(b"req2").await.unwrap();
        assert_eq!(b, br#"{"b":2}"#);
        let err = t.send(b"req3").await.unwrap_err();
        assert!(matches!(err, TransportError::Other(_)));
    }

    #[tokio::test]
    async fn stdio_transport_round_trips_with_cat_subprocess() {
        #[cfg(unix)]
        {
            use std::collections::HashMap;
            let t = StdioTransport::spawn("cat", &[], &HashMap::new())
                .await
                .unwrap();
            let bytes = t.send(b"hello-line").await.unwrap();
            assert_eq!(bytes, b"hello-line");
            t.kill().await;
        }
    }

    #[tokio::test]
    async fn stdio_transport_times_out_waiting_for_response_line() {
        #[cfg(unix)]
        {
            use std::collections::HashMap;
            use std::time::Duration;

            let args = vec![
                "-c".to_string(),
                "while read _line; do sleep 5; done".to_string(),
            ];
            let t = StdioTransport::spawn_with_response_timeout(
                "sh",
                &args,
                &HashMap::new(),
                Duration::from_millis(5),
            )
            .await
            .unwrap();
            let err = t.send(b"hello-line").await.unwrap_err();
            assert!(matches!(err, TransportError::Timeout(_)));
            assert!(err.to_string().contains("MCP stdio"));
            t.kill().await;
        }
    }
}
