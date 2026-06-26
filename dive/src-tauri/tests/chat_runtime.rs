use dive_lib::agent::{PendingApprovalSnapshot, PendingApprovals, PermissionDecision};
use dive_lib::tools::RiskLevel;

fn pending(id: &str, session_id: i64) -> PendingApprovalSnapshot {
    PendingApprovalSnapshot {
        id: id.into(),
        session_id,
        tool: "run_process".into(),
        params_preview: "command: \"pnpm test\"".into(),
        risk: RiskLevel::Danger,
        diff_preview: None,
        approval_warnings: dive_lib::agent::PermissionApprovalWarnings::default(),
        args: serde_json::json!({ "command": "pnpm", "args": ["test"] }),
    }
}

#[test]
fn stale_approval_registry_covers_cancel_missing_reload_and_validation_failure() {
    let approvals = PendingApprovals::new();
    let _rx = approvals.register(pending("cancelled", 10));
    assert_eq!(approvals.cancel_session(10), 1);
    assert!(approvals
        .resolve_with_snapshot("cancelled", PermissionDecision::approved())
        .is_none());

    assert!(approvals
        .resolve_with_snapshot("missing", PermissionDecision::approved())
        .is_none());

    let reloaded = PendingApprovals::new();
    assert!(reloaded
        .resolve_with_snapshot(
            "cancelled",
            PermissionDecision::denied("stale after reload")
        )
        .is_none());

    let validation_failed = PendingApprovals::new();
    assert!(validation_failed
        .resolve_with_snapshot(
            "validation-failed-before-approval",
            PermissionDecision::approved(),
        )
        .is_none());
}

#[test]
fn resolving_pending_approval_returns_snapshot_once() {
    let approvals = PendingApprovals::new();
    let _rx = approvals.register(pending("active", 20));

    let (snapshot, sent) = approvals
        .resolve_with_snapshot("active", PermissionDecision::denied("no"))
        .expect("active approval should resolve");
    assert_eq!(snapshot.session_id, 20);
    assert!(sent);
    assert!(approvals
        .resolve_with_snapshot("active", PermissionDecision::approved())
        .is_none());
}
