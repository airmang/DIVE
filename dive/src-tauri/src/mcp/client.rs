use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;

use super::transport::Transport;

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("rpc error {code}: {message}")]
    Rpc { code: i32, message: String },
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InitializeResult {
    pub protocol_version: String,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
    pub risk_hint: Option<String>,
}

#[derive(Debug, Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    #[serde(default)]
    jsonrpc: String,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
}

pub struct McpClient {
    transport: Box<dyn Transport>,
    next_id: AtomicU64,
    initialized: Mutex<Option<InitializeResult>>,
}

impl McpClient {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            transport,
            next_id: AtomicU64::new(1),
            initialized: Mutex::new(None),
        }
    }

    pub async fn initialize(&self) -> Result<InitializeResult, McpError> {
        let params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "DIVE", "version": env!("CARGO_PKG_VERSION")},
        });
        let raw = self.send("initialize", Some(params)).await?;
        let result = InitializeResult {
            protocol_version: raw
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            server_name: raw
                .get("serverInfo")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            server_version: raw
                .get("serverInfo")
                .and_then(|v| v.get("version"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
        };
        *self.initialized.lock().await = Some(result.clone());
        Ok(result)
    }

    pub async fn list_tools(&self) -> Result<Vec<McpToolInfo>, McpError> {
        let raw = self.send("tools/list", None).await?;
        let tools = raw
            .get("tools")
            .and_then(|v| v.as_array())
            .ok_or_else(|| McpError::Protocol("tools/list: missing tools array".into()))?;
        let mut out = Vec::with_capacity(tools.len());
        for item in tools {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| McpError::Protocol("tool: missing name".into()))?
                .to_string();
            let description = item
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let input_schema = item
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let risk_hint = item
                .get("annotations")
                .and_then(|v| v.get("riskLevel"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            out.push(McpToolInfo {
                name,
                description,
                input_schema,
                risk_hint,
            });
        }
        Ok(out)
    }

    pub async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, McpError> {
        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });
        self.send("tools/call", Some(params)).await
    }

    async fn send(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = RpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let req_bytes = serde_json::to_vec(&req)?;
        let resp_bytes = self
            .transport
            .send(&req_bytes)
            .await
            .map_err(|e| McpError::Transport(e.to_string()))?;
        let resp: RpcResponse = serde_json::from_slice(&resp_bytes)?;
        if resp.jsonrpc != "2.0" {
            return Err(McpError::Protocol(format!(
                "expected jsonrpc 2.0, got {:?}",
                resp.jsonrpc
            )));
        }
        if let Some(err) = resp.error {
            return Err(McpError::Rpc {
                code: err.code,
                message: err.message,
            });
        }
        match resp.id {
            Some(rid) if rid == id => {}
            Some(other) => {
                return Err(McpError::Protocol(format!(
                    "response id mismatch: sent {id} got {other}"
                )))
            }
            None => return Err(McpError::Protocol("response missing id".into())),
        }
        Ok(resp.result.unwrap_or(serde_json::Value::Null))
    }
}

#[async_trait]
pub trait RiskLevelFrom: Send + Sync {
    async fn risk_map(&self) -> HashMap<String, String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::MockTransport;

    fn mock_with(responses: Vec<serde_json::Value>) -> MockTransport {
        MockTransport::new(responses)
    }

    #[tokio::test]
    async fn initialize_parses_server_info() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "mock-server", "version": "1.0.0"},
                "capabilities": {},
            },
        })]);
        let client = McpClient::new(Box::new(mock));
        let info = client.initialize().await.unwrap();
        assert_eq!(info.protocol_version, "2024-11-05");
        assert_eq!(info.server_name.as_deref(), Some("mock-server"));
        assert_eq!(info.server_version.as_deref(), Some("1.0.0"));
    }

    #[tokio::test]
    async fn list_tools_parses_risk_hint_annotation() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [
                    {
                        "name": "read_url",
                        "description": "Read a URL",
                        "inputSchema": {"type": "object"},
                        "annotations": {"riskLevel": "safe"},
                    },
                    {
                        "name": "execute_sql",
                        "description": "Run SQL",
                        "inputSchema": {"type": "object"},
                        "annotations": {"riskLevel": "danger"},
                    },
                ],
            },
        })]);
        let client = McpClient::new(Box::new(mock));
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_url");
        assert_eq!(tools[0].risk_hint.as_deref(), Some("safe"));
        assert_eq!(tools[1].risk_hint.as_deref(), Some("danger"));
    }

    #[tokio::test]
    async fn list_tools_without_risk_hint_returns_none() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [{"name": "no_hint", "inputSchema": {}}],
            },
        })]);
        let client = McpClient::new(Box::new(mock));
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools[0].risk_hint, None);
    }

    #[tokio::test]
    async fn call_tool_returns_result_payload() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"content": [{"type": "text", "text": "ok"}]},
        })]);
        let client = McpClient::new(Box::new(mock));
        let result = client
            .call_tool("echo", serde_json::json!({"text": "hi"}))
            .await
            .unwrap();
        assert_eq!(
            result
                .get("content")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("text"))
                .and_then(|v| v.as_str()),
            Some("ok")
        );
    }

    #[tokio::test]
    async fn rpc_error_is_surfaced() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32601, "message": "method not found"},
        })]);
        let client = McpClient::new(Box::new(mock));
        let err = client.initialize().await.unwrap_err();
        match err {
            McpError::Rpc { code, message } => {
                assert_eq!(code, -32601);
                assert_eq!(message, "method not found");
            }
            other => panic!("expected Rpc, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn id_mismatch_is_protocol_error() {
        let mock = mock_with(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 999,
            "result": {},
        })]);
        let client = McpClient::new(Box::new(mock));
        let err = client.initialize().await.unwrap_err();
        assert!(matches!(err, McpError::Protocol(_)));
    }

    #[tokio::test]
    async fn ids_increment_across_calls() {
        let mock = mock_with(vec![
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {"protocolVersion": "2024-11-05"},
            }),
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "result": {"tools": []},
            }),
        ]);
        let client = McpClient::new(Box::new(mock));
        client.initialize().await.unwrap();
        let tools = client.list_tools().await.unwrap();
        assert_eq!(tools.len(), 0);
    }
}
