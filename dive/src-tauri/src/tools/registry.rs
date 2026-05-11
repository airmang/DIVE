use std::collections::HashMap;
use std::sync::Arc;

use crate::providers::ToolDef;

use super::{
    delete_file::DeleteFile, edit_file::EditFile, list_dir::ListDir, mkdir::Mkdir,
    read_file::ReadFile, run_process::RunProcess, search_files::SearchFiles, write_file::WriteFile,
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
        r.register(Arc::new(SearchFiles));
        r.register(Arc::new(Mkdir));
        r.register(Arc::new(DeleteFile));
        r.register(Arc::new(RunProcess));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::RiskLevel;

    #[test]
    fn builtins_include_track0_tools_with_expected_risk() {
        let registry = ToolRegistry::with_builtins();
        let expected = [
            ("read_file", RiskLevel::Safe),
            ("list_dir", RiskLevel::Safe),
            ("search_files", RiskLevel::Safe),
            ("write_file", RiskLevel::Warn),
            ("edit_file", RiskLevel::Warn),
            ("mkdir", RiskLevel::Warn),
            ("delete_file", RiskLevel::Danger),
            ("run_process", RiskLevel::Danger),
        ];
        assert_eq!(registry.list().len(), expected.len());
        for (name, risk) in expected {
            let tool = registry
                .get(name)
                .unwrap_or_else(|| panic!("missing {name}"));
            assert_eq!(tool.risk_level(), risk, "risk mismatch for {name}");
        }
    }
}
