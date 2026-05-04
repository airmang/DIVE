use std::collections::HashMap;
use thiserror::Error;

use super::client::{InitializeResult, McpClient, McpError, McpToolInfo};
use super::dao::McpServerRow;
use super::transport::{HttpTransport, StdioTransport, TransportError};

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("server {0} not found")]
    NotFound(i64),
    #[error("server {label}: missing field {field}")]
    MissingField { label: String, field: &'static str },
    #[error("transport: {0}")]
    Transport(#[from] TransportError),
    #[error("mcp: {0}")]
    Mcp(#[from] McpError),
}

pub struct McpServerRegistry;

impl McpServerRegistry {
    pub async fn connect(row: &McpServerRow) -> Result<McpClient, RegistryError> {
        match row.transport.as_str() {
            "http" => {
                let url = row
                    .url
                    .as_ref()
                    .ok_or_else(|| RegistryError::MissingField {
                        label: row.label.clone(),
                        field: "url",
                    })?;
                let mut t = HttpTransport::new(url);
                if let Some(headers) = &row.headers {
                    if let Some(obj) = headers.as_object() {
                        for (k, v) in obj {
                            if let Some(s) = v.as_str() {
                                t = t.with_header(k.clone(), s.to_string());
                            }
                        }
                    }
                }
                Ok(McpClient::new(Box::new(t)))
            }
            "stdio" => {
                let cmd = row
                    .command
                    .as_ref()
                    .ok_or_else(|| RegistryError::MissingField {
                        label: row.label.clone(),
                        field: "command",
                    })?;
                let args: Vec<String> = row
                    .args
                    .as_ref()
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let env: HashMap<String, String> = row
                    .env
                    .as_ref()
                    .and_then(|v| v.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();
                let t = StdioTransport::spawn(cmd, &args, &env).await?;
                Ok(McpClient::new(Box::new(t)))
            }
            other => Err(RegistryError::MissingField {
                label: row.label.clone(),
                field: Box::leak(format!("transport={other}").into_boxed_str()),
            }),
        }
    }

    pub async fn connect_and_initialize(
        row: &McpServerRow,
    ) -> Result<(McpClient, InitializeResult, Vec<McpToolInfo>), RegistryError> {
        let client = Self::connect(row).await?;
        let info = client.initialize().await?;
        let tools = client.list_tools().await?;
        Ok((client, info, tools))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::dao::NewMcpServer;

    #[tokio::test]
    async fn http_connect_builds_client_from_row() {
        let row = McpServerRow {
            id: 1,
            label: "t".into(),
            transport: "http".into(),
            command: None,
            args: None,
            env: None,
            url: Some("http://127.0.0.1:0/rpc".into()),
            headers: None,
            default_risk: "caution".into(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        };
        let result = McpServerRegistry::connect(&row).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn http_connect_without_url_errors() {
        let row = McpServerRow {
            id: 1,
            label: "t".into(),
            transport: "http".into(),
            command: None,
            args: None,
            env: None,
            url: None,
            headers: None,
            default_risk: "caution".into(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        };
        let err = match McpServerRegistry::connect(&row).await {
            Ok(_) => panic!("expected missing-field error"),
            Err(e) => e,
        };
        assert!(matches!(err, RegistryError::MissingField { .. }));
    }

    #[test]
    fn new_mcp_server_default_is_stdio_enabled() {
        let d = NewMcpServer::default();
        assert_eq!(d.transport, "stdio");
        assert!(d.enabled);
        assert_eq!(d.default_risk, "caution");
    }
}
