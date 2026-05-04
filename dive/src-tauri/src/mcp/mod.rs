//! MCP (Model Context Protocol) client. Spec §6.3.2, §8.5.
//!
//! Implements a minimal JSON-RPC 2.0 client for MCP servers. Two
//! transports are supported: `stdio` (subprocess with line-delimited
//! JSON) and `http` (POST /rpc with JSON body). The client performs
//! the `initialize` handshake and exposes `tools/list` and `tools/call`.
//!
//! This module deliberately avoids the experimental `rmcp` crate to
//! keep Windows ARM64 build compatibility. The subset of MCP we use
//! (initialize + tools/list + tools/call) is stable enough in the
//! protocol spec that a 200-line direct implementation is warranted.
//! Revisit `rmcp` in task 5-6 once v0.3 integration exposes gaps.
//!
//! External packages (e.g. `@modelcontextprotocol/server-filesystem`)
//! are not spawned during tests — a `MockTransport` is provided for
//! unit coverage. Real server integration is a user-runtime concern.

pub mod client;
pub mod dao;
pub mod registry;
pub mod tool_adapter;
pub mod transport;

pub use client::{InitializeResult, McpClient, McpError, McpToolInfo};
pub use dao::{McpServerRow, NewMcpServer};
pub use registry::{McpServerRegistry, RegistryError};
pub use tool_adapter::{
    is_mcp_tool, parse_qualified_tool_name, qualified_tool_name, McpToolAdapter, MCP_PREFIX,
};
pub use transport::{HttpTransport, MockTransport, StdioTransport, Transport, TransportKind};
