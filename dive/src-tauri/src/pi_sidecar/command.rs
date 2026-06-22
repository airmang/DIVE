use std::path::PathBuf;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

pub(super) fn default_sidecar_script_path() -> Result<PathBuf, String> {
    #[cfg(test)]
    {
        if let Some(path) = TEST_SIDECAR_SCRIPT_PATH
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|e| format!("test sidecar script lock: {e}"))?
            .clone()
        {
            return Ok(path);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dive_dir = manifest_dir
        .parent()
        .ok_or_else(|| "cannot resolve DIVE app directory".to_string())?;
    let script = dive_dir.join("pi-sidecar").join("src").join("main.mjs");
    if !script.exists() {
        return Err(format!("pi sidecar script not found: {}", script.display()));
    }
    Ok(script)
}

/// How to launch the sidecar process: a program plus any leading args.
#[derive(Debug)]
pub(super) struct SidecarCommand {
    pub(super) program: String,
    pub(super) prefix_args: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SidecarResolutionMode {
    Development,
    Packaged,
}

fn default_resolution_mode() -> SidecarResolutionMode {
    if cfg!(debug_assertions) {
        SidecarResolutionMode::Development
    } else {
        SidecarResolutionMode::Packaged
    }
}

/// Candidate path of the compiled sidecar binary shipped next to the app
/// executable via Tauri `externalBin`. `None` in contexts without a resolvable
/// executable path (e.g. some test harnesses).
pub(super) fn bundled_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "dive-pi-sidecar.exe"
    } else {
        "dive-pi-sidecar"
    };
    Some(dir.join(name))
}

/// Resolve how to spawn the sidecar. The packaged app ships a compiled
/// standalone binary (`externalBin`) and runs it directly. Development may
/// explicitly fall back to `node <script>`, but packaged/production mode fails
/// if the bundled binary is absent so packaging defects are not hidden until
/// classroom machines lack Node.
pub(super) fn resolve_sidecar_command(bundled: Option<PathBuf>) -> Result<SidecarCommand, String> {
    resolve_sidecar_command_for_mode(bundled, default_resolution_mode())
}

fn resolve_sidecar_command_for_mode(
    bundled: Option<PathBuf>,
    mode: SidecarResolutionMode,
) -> Result<SidecarCommand, String> {
    if let Some(bin) = bundled {
        if bin.exists() {
            return Ok(SidecarCommand {
                program: bin.display().to_string(),
                prefix_args: Vec::new(),
            });
        }
        if mode == SidecarResolutionMode::Packaged {
            return Err(format!(
                "bundled Pi sidecar missing: {}; packaged mode cannot fall back to node source script",
                bin.display()
            ));
        }
    } else if mode == SidecarResolutionMode::Packaged {
        return Err(
            "bundled Pi sidecar path unavailable; packaged mode cannot fall back to node source script"
                .to_string(),
        );
    }
    let script_path = default_sidecar_script_path()?;
    Ok(SidecarCommand {
        program: "node".to_string(),
        prefix_args: vec![script_path.display().to_string()],
    })
}

#[cfg(test)]
static TEST_SIDECAR_SCRIPT_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
pub(super) struct TestSidecarScriptPathGuard;

#[cfg(test)]
pub(super) fn set_test_sidecar_script_path(path: PathBuf) -> TestSidecarScriptPathGuard {
    let lock = TEST_SIDECAR_SCRIPT_PATH.get_or_init(|| Mutex::new(None));
    *lock.lock().unwrap() = Some(path);
    TestSidecarScriptPathGuard
}

#[cfg(test)]
impl Drop for TestSidecarScriptPathGuard {
    fn drop(&mut self) {
        if let Some(lock) = TEST_SIDECAR_SCRIPT_PATH.get() {
            *lock.lock().unwrap() = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn dev_resolution_falls_back_to_node_with_a_script() {
        let cmd = resolve_sidecar_command_for_mode(None, SidecarResolutionMode::Development)
            .expect("dev resolution");
        assert_eq!(cmd.program, "node");
        assert_eq!(cmd.prefix_args.len(), 1);
        assert!(cmd.prefix_args[0].ends_with(".mjs"));
    }

    #[test]
    fn release_resolution_uses_bundled_binary_when_present() {
        // A path that exists stands in for a shipped bundled binary.
        let present = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("pi_sidecar.rs");
        let cmd = resolve_sidecar_command_for_mode(
            Some(present.clone()),
            SidecarResolutionMode::Packaged,
        )
        .expect("release resolution");
        assert_eq!(cmd.program, present.display().to_string());
        assert!(cmd.prefix_args.is_empty());
    }

    #[test]
    fn packaged_resolution_fails_when_bundled_binary_is_missing_even_if_source_script_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let script = tmp.path().join("main.mjs");
        std::fs::write(&script, "console.log('dev only');").unwrap();
        let _guard = set_test_sidecar_script_path(script);
        let missing_bundled = tmp.path().join("dive-pi-sidecar");

        let err = resolve_sidecar_command_for_mode(
            Some(missing_bundled),
            SidecarResolutionMode::Packaged,
        )
        .expect_err("packaged mode must not fall back to node source script");

        assert!(err.contains("bundled Pi sidecar missing"), "{err}");
        assert!(
            err.contains("cannot fall back to node source script"),
            "{err}"
        );
    }
}
