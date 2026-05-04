use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;

use super::client::{InitializeResult, McpClient, McpError, McpToolInfo};
use super::dao::McpServerRow;
use super::tool_adapter::McpToolAdapter;
use super::transport::{HttpTransport, StdioTransport, TransportError};
use crate::tools::{RiskLevel, ToolRegistry};

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("server {0} not found")]
    NotFound(i64),
    #[error("server {label}: missing field {field}")]
    MissingField { label: String, field: &'static str },
    #[error("invalid default_risk {value}")]
    InvalidRisk { value: String },
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

    pub fn default_risk_of(row: &McpServerRow) -> Result<RiskLevel, RegistryError> {
        match row.default_risk.as_str() {
            "safe" => Ok(RiskLevel::Safe),
            "caution" | "warn" => Ok(RiskLevel::Warn),
            "danger" => Ok(RiskLevel::Danger),
            other => Err(RegistryError::InvalidRisk {
                value: other.to_string(),
            }),
        }
    }

    pub fn build_adapters(
        row: &McpServerRow,
        client: Arc<McpClient>,
        tools: &[McpToolInfo],
    ) -> Result<Vec<McpToolAdapter>, RegistryError> {
        let default_risk = Self::default_risk_of(row)?;
        let adapters = tools
            .iter()
            .map(|info| {
                McpToolAdapter::new(
                    &row.label,
                    info.name.clone(),
                    info.description.clone(),
                    info.input_schema.clone(),
                    default_risk,
                    info.risk_hint.as_deref(),
                    client.clone(),
                )
            })
            .collect();
        Ok(adapters)
    }

    pub fn register_adapters(registry: &mut ToolRegistry, adapters: Vec<McpToolAdapter>) {
        for adapter in adapters {
            registry.register(Arc::new(adapter));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::dao::NewMcpServer;
    use crate::tools::Tool;

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

    fn row_with_risk(risk: &str) -> McpServerRow {
        McpServerRow {
            id: 1,
            label: "t".into(),
            transport: "http".into(),
            command: None,
            args: None,
            env: None,
            url: Some("http://x/rpc".into()),
            headers: None,
            default_risk: risk.into(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn default_risk_parses_three_variants() {
        assert_eq!(
            McpServerRegistry::default_risk_of(&row_with_risk("safe")).unwrap(),
            RiskLevel::Safe
        );
        assert_eq!(
            McpServerRegistry::default_risk_of(&row_with_risk("caution")).unwrap(),
            RiskLevel::Warn
        );
        assert_eq!(
            McpServerRegistry::default_risk_of(&row_with_risk("danger")).unwrap(),
            RiskLevel::Danger
        );
        let err = McpServerRegistry::default_risk_of(&row_with_risk("unknown")).unwrap_err();
        assert!(matches!(err, RegistryError::InvalidRisk { .. }));
    }

    #[tokio::test]
    async fn build_adapters_merges_default_and_hint() {
        use crate::mcp::transport::MockTransport;

        let row = McpServerRow {
            default_risk: "safe".into(),
            ..row_with_risk("safe")
        };
        let client = Arc::new(McpClient::new(Box::new(MockTransport::new(vec![]))));
        let tools = vec![
            McpToolInfo {
                name: "reader".into(),
                description: None,
                input_schema: serde_json::json!({}),
                risk_hint: Some("safe".into()),
            },
            McpToolInfo {
                name: "shell".into(),
                description: None,
                input_schema: serde_json::json!({}),
                risk_hint: Some("danger".into()),
            },
        ];
        let adapters = McpServerRegistry::build_adapters(&row, client, &tools).unwrap();
        assert_eq!(adapters.len(), 2);
        assert_eq!(adapters[0].name(), "mcp__t__reader");
        assert_eq!(adapters[0].risk_level(), RiskLevel::Safe);
        assert_eq!(adapters[1].name(), "mcp__t__shell");
        assert_eq!(adapters[1].risk_level(), RiskLevel::Danger);
    }

    #[tokio::test]
    async fn register_adapters_inserts_into_tool_registry() {
        use crate::mcp::transport::MockTransport;

        let row = row_with_risk("safe");
        let client = Arc::new(McpClient::new(Box::new(MockTransport::new(vec![]))));
        let tools = vec![McpToolInfo {
            name: "reader".into(),
            description: None,
            input_schema: serde_json::json!({}),
            risk_hint: None,
        }];
        let adapters = McpServerRegistry::build_adapters(&row, client, &tools).unwrap();
        let mut registry = ToolRegistry::with_builtins();
        McpServerRegistry::register_adapters(&mut registry, adapters);
        assert!(registry.get("mcp__t__reader").is_some());
        assert!(registry.get("read_file").is_some());
    }
}
