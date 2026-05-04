use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::client::McpClient;
use crate::tools::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

pub const MCP_PREFIX: &str = "mcp__";

pub struct McpToolAdapter {
    qualified_name: String,
    remote_name: String,
    description: String,
    input_schema: Value,
    risk: RiskLevel,
    client: Arc<McpClient>,
}

impl McpToolAdapter {
    pub fn new(
        server_label: &str,
        remote_name: String,
        description: Option<String>,
        input_schema: Value,
        default_risk: RiskLevel,
        risk_hint: Option<&str>,
        client: Arc<McpClient>,
    ) -> Self {
        let risk = merge_risk(default_risk, risk_hint);
        let qualified_name = qualified_tool_name(server_label, &remote_name);
        let description = description.unwrap_or_else(|| format!("MCP 도구 ({server_label})"));
        Self {
            qualified_name,
            remote_name,
            description,
            input_schema,
            risk,
            client,
        }
    }

    pub fn qualified_name(&self) -> &str {
        &self.qualified_name
    }

    pub fn remote_name(&self) -> &str {
        &self.remote_name
    }
}

pub fn qualified_tool_name(server_label: &str, remote_name: &str) -> String {
    format!("{MCP_PREFIX}{server_label}__{remote_name}")
}

pub fn is_mcp_tool(name: &str) -> bool {
    name.starts_with(MCP_PREFIX)
}

pub fn parse_qualified_tool_name(name: &str) -> Option<(&str, &str)> {
    let rest = name.strip_prefix(MCP_PREFIX)?;
    rest.split_once("__")
}

fn parse_risk(s: &str) -> Option<RiskLevel> {
    match s.to_ascii_lowercase().as_str() {
        "safe" => Some(RiskLevel::Safe),
        "warn" | "caution" => Some(RiskLevel::Warn),
        "danger" | "destructive" => Some(RiskLevel::Danger),
        _ => None,
    }
}

fn merge_risk(default_risk: RiskLevel, hint: Option<&str>) -> RiskLevel {
    let hinted = hint.and_then(parse_risk);
    match (default_risk, hinted) {
        (_, Some(h)) => max_risk(default_risk, h),
        (d, None) => d,
    }
}

fn max_risk(a: RiskLevel, b: RiskLevel) -> RiskLevel {
    let rank = |r: RiskLevel| match r {
        RiskLevel::Safe => 0,
        RiskLevel::Warn => 1,
        RiskLevel::Danger => 2,
    };
    if rank(a) >= rank(b) {
        a
    } else {
        b
    }
}

#[async_trait]
impl Tool for McpToolAdapter {
    fn name(&self) -> &str {
        &self.qualified_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> Value {
        self.input_schema.clone()
    }

    fn risk_level(&self) -> RiskLevel {
        self.risk
    }

    async fn run(&self, input: Value, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let result = self
            .client
            .call_tool(&self.remote_name, input)
            .await
            .map_err(|e| ToolError::InvalidInput(format!("mcp: {e}")))?;
        let summary = summarize(&result);
        Ok(ToolOutput::success(summary, result))
    }
}

fn summarize(result: &Value) -> String {
    if let Some(arr) = result.get("content").and_then(|v| v.as_array()) {
        let texts: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect();
        if !texts.is_empty() {
            let joined = texts.join("\n");
            return truncate(&joined, 200);
        }
    }
    truncate(&result.to_string(), 200)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::transport::MockTransport;
    use crate::tools::ToolContext;
    use std::path::PathBuf;

    fn mk_client(responses: Vec<serde_json::Value>) -> Arc<McpClient> {
        Arc::new(McpClient::new(Box::new(MockTransport::new(responses))))
    }

    #[test]
    fn qualified_name_format() {
        assert_eq!(qualified_tool_name("fs", "read_file"), "mcp__fs__read_file");
        assert!(is_mcp_tool("mcp__fs__read_file"));
        assert!(!is_mcp_tool("read_file"));
        assert_eq!(
            parse_qualified_tool_name("mcp__fs__read_file"),
            Some(("fs", "read_file"))
        );
        assert_eq!(parse_qualified_tool_name("read_file"), None);
    }

    #[test]
    fn merge_risk_takes_max() {
        assert_eq!(
            merge_risk(RiskLevel::Safe, Some("danger")),
            RiskLevel::Danger
        );
        assert_eq!(
            merge_risk(RiskLevel::Danger, Some("safe")),
            RiskLevel::Danger
        );
        assert_eq!(merge_risk(RiskLevel::Safe, Some("safe")), RiskLevel::Safe);
        assert_eq!(merge_risk(RiskLevel::Warn, None), RiskLevel::Warn);
        assert_eq!(
            merge_risk(RiskLevel::Safe, Some("caution")),
            RiskLevel::Warn
        );
        assert_eq!(
            merge_risk(RiskLevel::Warn, Some("unknown")),
            RiskLevel::Warn
        );
    }

    #[tokio::test]
    async fn run_forwards_to_tools_call_and_summarizes_text() {
        let client = mk_client(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"content": [{"type": "text", "text": "hello from mcp"}]},
        })]);
        let adapter = McpToolAdapter::new(
            "fs",
            "read_file".into(),
            Some("read a file via MCP".into()),
            serde_json::json!({"type": "object"}),
            RiskLevel::Safe,
            None,
            client,
        );
        assert_eq!(adapter.name(), "mcp__fs__read_file");
        assert_eq!(adapter.risk_level(), RiskLevel::Safe);
        let ctx = ToolContext::new(PathBuf::from("."), 1);
        let output = adapter
            .run(serde_json::json!({"path": "/etc/hosts"}), &ctx)
            .await
            .unwrap();
        assert!(output.success);
        assert_eq!(output.summary, "hello from mcp");
    }

    #[tokio::test]
    async fn run_rpc_error_surfaces_as_tool_error() {
        let client = mk_client(vec![serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32601, "message": "method not found"},
        })]);
        let adapter = McpToolAdapter::new(
            "fs",
            "bogus".into(),
            None,
            serde_json::json!({}),
            RiskLevel::Safe,
            None,
            client,
        );
        let ctx = ToolContext::new(PathBuf::from("."), 1);
        let err = adapter.run(serde_json::json!({}), &ctx).await.unwrap_err();
        match err {
            ToolError::InvalidInput(msg) => assert!(msg.contains("method not found")),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn hint_escalates_default_to_danger() {
        let client = mk_client(vec![]);
        let adapter = McpToolAdapter::new(
            "grading",
            "run_sql".into(),
            None,
            serde_json::json!({}),
            RiskLevel::Safe,
            Some("danger"),
            client,
        );
        assert_eq!(adapter.risk_level(), RiskLevel::Danger);
    }
}
