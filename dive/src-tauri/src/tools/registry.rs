use std::collections::HashMap;
use std::sync::Arc;

use crate::providers::ToolDef;

use super::{
    bash::Bash, edit_file::EditFile, list_dir::ListDir, read_file::ReadFile, write_file::WriteFile,
    Tool,
};

/// Registry of built-in tools indexed by name. Tools are `Arc<dyn Tool>` so
/// the registry can be shared across threads (Tauri app state).
#[derive(Clone)]
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn with_builtins() -> Self {
        let mut r = Self::new();
        r.register(Arc::new(ReadFile));
        r.register(Arc::new(ListDir));
        r.register(Arc::new(WriteFile));
        r.register(Arc::new(EditFile));
        r.register(Arc::new(Bash));
        r
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    pub fn list(&self) -> Vec<Arc<dyn Tool>> {
        self.tools.values().cloned().collect()
    }

    /// Convert the registry to `ToolDef` list for `ChatRequest`.
    pub fn tool_defs(&self) -> Vec<ToolDef> {
        self.tools
            .values()
            .map(|t| ToolDef {
                name: t.name().into(),
                description: t.description().into(),
                parameters: t.input_schema(),
            })
            .collect()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::with_builtins()
    }
}
