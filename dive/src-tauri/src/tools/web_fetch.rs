use async_trait::async_trait;
use bytes::Bytes;
use futures::StreamExt;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::egress_guard::{
    classify_egress_url, safe_url_log_parts, validate_redirect_target, validate_resolved_target,
    EgressBlockReason, EgressPolicy, EgressTarget, ValidatedTarget, WebUnavailableReason,
};
use super::{truncate_utf8, RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

pub const WEB_FETCH_TOOL_NAME: &str = "web_fetch";
pub const MAX_RESPONSE_BYTES: u64 = 3 * 1024 * 1024;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);
pub const READ_TIMEOUT: Duration = Duration::from_secs(5);
pub const TOTAL_DEADLINE: Duration = Duration::from_secs(25);
pub const MAX_REDIRECTS: u8 = 3;
const BODY_SNIPPET_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Deserialize)]
struct WebFetchInput {
    url: String,
    purpose: String,
    #[serde(default)]
    web_fetch_approval: Option<WebFetchApproval>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchApproval {
    pub host: String,
    pub pinned_ip: IpAddr,
    pub port: u16,
    pub scheme: String,
    pub path_hash: String,
    pub query_dropped: bool,
    pub purpose: String,
    pub approved_at: i64,
}

/// A DNS rebind is detected (and the fetch must re-prompt) when the freshly
/// resolved target no longer matches the user-approved host/port, or when the
/// exact IP the user approved is no longer among the resolved addresses.
///
/// Membership — not `ips[0]` ordering — is what matters: `validate_resolved_target`
/// has already fail-closed on any internal address in `ips`, so an approved IP that
/// is still present is still a validated public address, and ordinary multi-A /
/// round-robin CDN hosts (Cloudflare, Akamai, …) must not spuriously re-prompt just
/// because DNS returned the same addresses in a different order (SEC-P2-2).
fn fetch_pin_rebind_detected(
    approval: &WebFetchApproval,
    resolved_host: &str,
    resolved_port: u16,
    resolved_ips: &[IpAddr],
) -> bool {
    approval.host != resolved_host
        || approval.port != resolved_port
        || !resolved_ips.contains(&approval.pinned_ip)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchAttemptLog {
    pub url: super::egress_guard::ValueLogParts,
    pub purpose: String,
}

#[async_trait]
pub trait EgressResolver: Send + Sync {
    async fn resolve(&self, target: &EgressTarget) -> Result<Vec<IpAddr>, EgressBlockReason>;
}

#[derive(Debug, Default)]
pub struct SystemEgressResolver;

#[async_trait]
impl EgressResolver for SystemEgressResolver {
    async fn resolve(&self, target: &EgressTarget) -> Result<Vec<IpAddr>, EgressBlockReason> {
        if let Some(ip) = target.literal_ip {
            return Ok(vec![ip]);
        }
        // Bound the resolve so a slow/hung authoritative DNS for a model-chosen
        // host fails clear instead of stalling the turn before the fetch
        // deadline applies (the approval-prep resolve runs outside run()'s
        // total_deadline wrapper).
        let addrs = tokio::time::timeout(
            RESOLVE_TIMEOUT,
            tokio::net::lookup_host((target.host.as_str(), target.port)),
        )
        .await
        .map_err(|_| EgressBlockReason::DnsResolutionFailed {
            host: target.host.clone(),
        })?
        .map_err(|_| EgressBlockReason::DnsResolutionFailed {
            host: target.host.clone(),
        })?;
        let mut seen = HashSet::new();
        let mut ips = Vec::new();
        for addr in addrs {
            if seen.insert(addr.ip()) {
                ips.push(addr.ip());
            }
        }
        if ips.is_empty() {
            return Err(EgressBlockReason::DnsResolutionFailed {
                host: target.host.clone(),
            });
        }
        Ok(ips)
    }
}

#[derive(Debug, Clone)]
pub struct WebFetchConfig {
    pub policy: EgressPolicy,
    pub max_response_bytes: u64,
    pub connect_timeout: Duration,
    pub read_timeout: Duration,
    pub total_deadline: Duration,
    pub max_redirects: u8,
}

impl Default for WebFetchConfig {
    fn default() -> Self {
        Self {
            policy: EgressPolicy::default(),
            max_response_bytes: MAX_RESPONSE_BYTES,
            connect_timeout: CONNECT_TIMEOUT,
            read_timeout: READ_TIMEOUT,
            total_deadline: TOTAL_DEADLINE,
            max_redirects: MAX_REDIRECTS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchClientProfile {
    pub custom_resolver: bool,
    pub redirect_policy_none: bool,
    pub transparent_decompression_disabled: bool,
    pub connect_timeout_ms: u128,
    pub total_deadline_ms: u128,
    pub max_response_bytes: u64,
}

pub fn client_profile() -> WebFetchClientProfile {
    let config = WebFetchConfig::default();
    WebFetchClientProfile {
        custom_resolver: true,
        redirect_policy_none: true,
        transparent_decompression_disabled: true,
        connect_timeout_ms: config.connect_timeout.as_millis(),
        total_deadline_ms: config.total_deadline.as_millis(),
        max_response_bytes: config.max_response_bytes,
    }
}

pub async fn prepare_approval_args(input: &Value) -> Result<(Value, WebFetchApproval), ToolError> {
    let resolver = Arc::new(SystemEgressResolver);
    prepare_approval_args_with_resolver(input, resolver, WebFetchConfig::default()).await
}

pub async fn prepare_approval_args_with_resolver(
    input: &Value,
    resolver: Arc<dyn EgressResolver>,
    config: WebFetchConfig,
) -> Result<(Value, WebFetchApproval), ToolError> {
    let parsed: WebFetchInput = serde_json::from_value(input.clone())
        .map_err(|e| ToolError::InvalidInput(e.to_string()))?;
    validate_input_shape(&parsed)?;
    let target =
        classify_egress_url(&parsed.url, config.policy).map_err(ToolError::EgressBlocked)?;
    let ips = resolver
        .resolve(&target)
        .await
        .map_err(ToolError::EgressBlocked)?;
    let validated = validate_resolved_target(&target, &ips).map_err(ToolError::EgressBlocked)?;
    let approval = WebFetchApproval {
        host: validated.host,
        pinned_ip: validated.pinned_ip,
        port: validated.port,
        scheme: validated.scheme.as_str().to_string(),
        path_hash: validated.path_hash,
        query_dropped: validated.query_dropped,
        purpose: parsed.purpose.clone(),
        approved_at: crate::db::now_ms(),
    };
    let mut prepared = input.clone();
    prepared["reuse_for_session"] = json!(false);
    prepared["web_fetch_approval"] = serde_json::to_value(&approval).map_err(ToolError::Json)?;
    Ok((prepared, approval))
}

pub fn session_grant_key(input: &Value) -> Option<String> {
    let approval: WebFetchApproval =
        serde_json::from_value(input.get("web_fetch_approval")?.clone()).ok()?;
    let scheme = approval.scheme.trim().to_ascii_lowercase();
    let host = approval.host.trim().to_ascii_lowercase();
    let purpose = approval.purpose.trim();
    if scheme.is_empty() || host.is_empty() || purpose.is_empty() {
        return None;
    }
    Some(format!(
        "{scheme}|{host}|{}|{}|{purpose}",
        approval.port, approval.pinned_ip
    ))
}

pub fn attempt_log_from_input(input: &Value) -> WebFetchAttemptLog {
    let url = input.get("url").and_then(Value::as_str).unwrap_or("");
    let purpose = input
        .get("purpose")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    WebFetchAttemptLog {
        url: safe_url_log_parts(url),
        purpose,
    }
}

pub struct WebFetch {
    resolver: Arc<dyn EgressResolver>,
    config: WebFetchConfig,
}

impl WebFetch {
    pub fn new() -> Self {
        Self {
            resolver: Arc::new(SystemEgressResolver),
            config: WebFetchConfig::default(),
        }
    }

    #[cfg(test)]
    pub fn with_resolver(resolver: Arc<dyn EgressResolver>, config: WebFetchConfig) -> Self {
        Self { resolver, config }
    }
}

impl Default for WebFetch {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WebFetch {
    fn name(&self) -> &str {
        WEB_FETCH_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Fetch one public HTTPS URL for build-time reference. GET-only, Rust-validated, SSRF-guarded, bounded, and never verification evidence."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute public https URL to read. Do not use localhost, private IPs, credentials, or non-http schemes."
                },
                "purpose": {
                    "type": "string",
                    "description": "Why this external reference is needed for the current build step. This is shown to the student as unverified AI-provided context."
                }
            },
            "required": ["url", "purpose"],
            "additionalProperties": false
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Danger
    }

    fn validate(&self, input: &Value) -> Result<(), ToolError> {
        let parsed: WebFetchInput = serde_json::from_value(input.clone())
            .map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        validate_input_shape(&parsed)?;
        classify_egress_url(&parsed.url, self.config.policy)
            .map(|_| ())
            .map_err(ToolError::EgressBlocked)
    }

    async fn run(&self, input: Value, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        self.validate(&input)?;
        let parsed: WebFetchInput =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let approval = parsed.web_fetch_approval.clone().ok_or_else(|| {
            ToolError::InvalidInput("web_fetch requires a validated approval target".into())
        })?;
        let start = Instant::now();
        let result = match tokio::time::timeout(
            self.config.total_deadline,
            self.fetch_with_manual_redirects(&parsed, &approval),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                return Ok(web_fetch_failure_output(
                    &parsed.url,
                    &parsed.purpose,
                    EgressBlockReason::DeadlineExceeded,
                    start,
                ));
            }
        };

        match result {
            Ok(mut output) => {
                let elapsed_ms = start.elapsed().as_millis() as u64;
                output.full["elapsedMs"] = json!(elapsed_ms);
                Ok(output)
            }
            Err(reason) => Ok(web_fetch_failure_output(
                &parsed.url,
                &parsed.purpose,
                reason,
                start,
            )),
        }
    }
}

fn validate_input_shape(input: &WebFetchInput) -> Result<(), ToolError> {
    if input.url.trim().is_empty() {
        return Err(ToolError::InvalidInput("url must not be empty".into()));
    }
    if input.purpose.trim().is_empty() {
        return Err(ToolError::InvalidInput("purpose must not be empty".into()));
    }
    Ok(())
}

#[derive(Debug)]
struct BoundedBody {
    bytes_on_wire: u64,
    snippet: Vec<u8>,
    truncated: bool,
}

async fn read_bounded_body(
    response: reqwest::Response,
    max_response_bytes: u64,
    snippet_cap: usize,
) -> Result<BoundedBody, EgressBlockReason> {
    let stream = response
        .bytes_stream()
        .map(|chunk| chunk.map_err(|_| EgressBlockReason::DeadlineExceeded));
    read_bounded_byte_stream(stream, max_response_bytes, snippet_cap).await
}

async fn read_bounded_byte_stream<S>(
    stream: S,
    max_response_bytes: u64,
    snippet_cap: usize,
) -> Result<BoundedBody, EgressBlockReason>
where
    S: futures::Stream<Item = Result<Bytes, EgressBlockReason>>,
{
    let mut bytes_on_wire: u64 = 0;
    let mut snippet = Vec::new();
    futures::pin_mut!(stream);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        bytes_on_wire = bytes_on_wire.saturating_add(chunk.len() as u64);
        if bytes_on_wire > max_response_bytes {
            return Err(EgressBlockReason::ResponseTooLarge {
                cap_bytes: max_response_bytes,
            });
        }
        if snippet.len() < snippet_cap {
            let remaining = snippet_cap - snippet.len();
            snippet.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }
    }
    Ok(BoundedBody {
        bytes_on_wire,
        truncated: bytes_on_wire as usize > snippet.len(),
        snippet,
    })
}

impl WebFetch {
    async fn validate_redirect_location_before_socket(
        &self,
        hop: u8,
        base_url: &reqwest::Url,
        location: &str,
    ) -> Result<String, EgressBlockReason> {
        let next_url = base_url
            .join(location)
            .map_err(|_| EgressBlockReason::NonAbsoluteUrl)?
            .to_string();
        let target = classify_egress_url(&next_url, self.config.policy)?;
        let ips = self.resolver.resolve(&target).await?;
        validate_redirect_target(hop, &target, &ips)?;
        Ok(next_url)
    }

    async fn fetch_with_manual_redirects(
        &self,
        input: &WebFetchInput,
        approval: &WebFetchApproval,
    ) -> Result<ToolOutput, EgressBlockReason> {
        let mut current_url = input.url.clone();
        let mut hop: u8 = 0;
        loop {
            let target = classify_egress_url(&current_url, self.config.policy)?;
            let ips = self.resolver.resolve(&target).await?;
            let validated = if hop == 0 {
                // validate_resolved_target fail-closes if ANY freshly resolved IP is
                // internal — that is the real DNS-rebind protection. We then require the
                // user-approved IP to still be a MEMBER of the resolved set (not that it
                // is ips[0]) and pin the connection to that exact approved IP. Matching by
                // membership rather than order stops ordinary multi-A / round-robin CDN
                // hosts (Cloudflare, Akamai, …) from spuriously re-prompting when DNS
                // returns the same addresses in a different order (SEC-P2-2). If the
                // approved IP has left the set the host has genuinely rotated → re-prompt.
                let fetch_time = validate_resolved_target(&target, &ips)?;
                if fetch_pin_rebind_detected(approval, &fetch_time.host, fetch_time.port, &ips) {
                    return Err(EgressBlockReason::ResolvedIpChangedAtFetch {
                        host: fetch_time.host,
                        approved_ip: approval.pinned_ip,
                        resolved_ip: fetch_time.pinned_ip,
                    });
                }
                ValidatedTarget {
                    pinned_ip: approval.pinned_ip,
                    ..fetch_time
                }
            } else {
                validate_redirect_target(hop, &target, &ips)?
            };

            let client = pinned_client(&validated, self.config.clone())?;
            let response = client
                .get(current_url.clone())
                .header(reqwest::header::ACCEPT_ENCODING, "identity")
                .send()
                .await
                .map_err(|_| EgressBlockReason::DnsResolutionFailed {
                    host: target.host.clone(),
                })?;

            if response.status().is_redirection() {
                hop = hop.saturating_add(1);
                if hop > self.config.max_redirects {
                    return Err(EgressBlockReason::TooManyRedirects);
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or(EgressBlockReason::TooManyRedirects)?;
                current_url = self
                    .validate_redirect_location_before_socket(hop, response.url(), location)
                    .await?;
                continue;
            }

            let status = response.status();
            let final_url = response.url().to_string();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body =
                read_bounded_body(response, self.config.max_response_bytes, BODY_SNIPPET_BYTES)
                    .await?;
            let body_snippet = String::from_utf8_lossy(&body.snippet).into_owned();
            let summary = format!(
                "web fetch completed: HTTP {} · {} bytes",
                status.as_u16(),
                body.bytes_on_wire
            );
            return Ok(ToolOutput {
                success: status.is_success(),
                summary: summary.clone(),
                full: json!({
                    "runtimeAction": "web_fetch",
                    "status": "completed",
                    "success": status.is_success(),
                    "finalUrl": safe_url_label(&final_url),
                    "statusCode": status.as_u16(),
                    "contentType": content_type,
                    "bodySnippet": truncate_utf8(&body_snippet, BODY_SNIPPET_BYTES, "\n... [truncated]"),
                    "truncated": body.truncated,
                    "bytesOnWire": body.bytes_on_wire,
                    "isEvidence": false,
                    "summary": summary,
                    "host": validated.host,
                    "resolvedIp": validated.pinned_ip.to_string(),
                }),
            });
        }
    }
}

fn pinned_client(
    target: &ValidatedTarget,
    config: WebFetchConfig,
) -> Result<reqwest::Client, EgressBlockReason> {
    let resolver = Arc::new(PinnedReqwestResolver {
        host: target.host.clone(),
        addr: SocketAddr::new(target.pinned_ip, target.port),
    });
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(config.connect_timeout)
        .read_timeout(config.read_timeout)
        .dns_resolver(resolver)
        .build()
        .map_err(|_| EgressBlockReason::DnsResolutionFailed {
            host: target.host.clone(),
        })
}

#[derive(Debug)]
struct PinnedReqwestResolver {
    host: String,
    addr: SocketAddr,
}

impl Resolve for PinnedReqwestResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let requested = name.as_str().trim_end_matches('.').to_ascii_lowercase();
        let expected = self.host.to_ascii_lowercase();
        let addr = self.addr;
        Box::pin(async move {
            if requested == expected {
                let addrs: Addrs = Box::new(std::iter::once(addr));
                Ok(addrs)
            } else {
                Err(format!("web_fetch resolver has no pin for {requested}").into())
            }
        })
    }
}

fn web_fetch_failure_output(
    url: &str,
    purpose: &str,
    reason: EgressBlockReason,
    start: Instant,
) -> ToolOutput {
    let unavailable = reason.unavailable_reason();
    let summary = reason.safe_agent_message().to_string();
    ToolOutput::failure(
        summary.clone(),
        json!({
            "runtimeAction": "web_fetch",
            "status": match unavailable {
                WebUnavailableReason::Offline | WebUnavailableReason::Timeout => "unavailable",
                _ => "blocked",
            },
            "success": false,
            "summary": summary,
            "url": safe_url_log_parts(url),
            "purpose": purpose,
            "errorClass": reason.code(),
            "unavailableReason": unavailable.as_str(),
            "bytesOnWire": 0,
            "elapsedMs": start.elapsed().as_millis() as u64,
            "isEvidence": false,
        }),
    )
}

fn safe_url_label(raw: &str) -> String {
    let parts = safe_url_log_parts(raw);
    let port = parts
        .port
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    if parts.host.is_empty() {
        format!("{}://[invalid]/#{}", parts.scheme, parts.path_hash)
    } else {
        format!(
            "{}://{}{}#path-{}",
            parts.scheme, parts.host, port, parts.path_hash
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tokio::time::sleep;

    #[derive(Default)]
    struct MockResolver {
        answers: Mutex<HashMap<String, Vec<Vec<IpAddr>>>>,
    }

    impl MockResolver {
        fn with_answers(entries: Vec<(&str, Vec<Vec<IpAddr>>)>) -> Arc<Self> {
            Arc::new(Self {
                answers: Mutex::new(
                    entries
                        .into_iter()
                        .map(|(host, answers)| (host.to_string(), answers))
                        .collect(),
                ),
            })
        }
    }

    #[async_trait]
    impl EgressResolver for MockResolver {
        async fn resolve(&self, target: &EgressTarget) -> Result<Vec<IpAddr>, EgressBlockReason> {
            let mut answers = self.answers.lock().unwrap();
            let Some(queue) = answers.get_mut(&target.host) else {
                return Err(EgressBlockReason::DnsResolutionFailed {
                    host: target.host.clone(),
                });
            };
            if queue.is_empty() {
                return Err(EgressBlockReason::DnsResolutionFailed {
                    host: target.host.clone(),
                });
            }
            Ok(queue.remove(0))
        }
    }

    struct SlowResolver {
        delay: Duration,
        ip: IpAddr,
    }

    #[async_trait]
    impl EgressResolver for SlowResolver {
        async fn resolve(&self, _target: &EgressTarget) -> Result<Vec<IpAddr>, EgressBlockReason> {
            sleep(self.delay).await;
            Ok(vec![self.ip])
        }
    }

    fn public_ip() -> IpAddr {
        IpAddr::V4(std::net::Ipv4Addr::new(93, 184, 216, 34))
    }

    #[tokio::test]
    async fn prepare_approval_args_resolves_and_pins_public_https_target() {
        let resolver = MockResolver::with_answers(vec![("example.com", vec![vec![public_ip()]])]);
        let (prepared, approval) = prepare_approval_args_with_resolver(
            &json!({
                "url": "https://example.com/docs?token=secret",
                "purpose": "Read docs.",
                "reuse_for_session": true
            }),
            resolver,
            WebFetchConfig::default(),
        )
        .await
        .unwrap();
        assert_eq!(approval.host, "example.com");
        assert_eq!(approval.pinned_ip, public_ip());
        assert_eq!(prepared["web_fetch_approval"]["queryDropped"], true);
        assert!(prepared["web_fetch_approval"].get("token").is_none());
        assert_eq!(prepared["reuse_for_session"], false);
    }

    #[tokio::test]
    async fn prepare_approval_args_blocks_mixed_public_and_loopback_answers() {
        let resolver = MockResolver::with_answers(vec![(
            "example.com",
            vec![vec![public_ip(), IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)]],
        )]);
        let err = prepare_approval_args_with_resolver(
            &json!({ "url": "https://example.com/", "purpose": "Read docs." }),
            resolver,
            WebFetchConfig::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ToolError::EgressBlocked(_)));
    }

    #[tokio::test]
    async fn run_blocks_when_resolved_ip_differs_from_approved_card_ip() {
        let resolver = MockResolver::with_answers(vec![(
            "example.com",
            vec![vec![IpAddr::V4(std::net::Ipv4Addr::new(93, 184, 216, 35))]],
        )]);
        let tool = WebFetch::with_resolver(resolver, WebFetchConfig::default());
        let out = tool
            .run(
                json!({
                    "url": "https://example.com/",
                    "purpose": "Read docs.",
                    "web_fetch_approval": {
                        "host": "example.com",
                        "pinnedIp": public_ip(),
                        "port": 443,
                        "scheme": "https",
                        "pathHash": "abcd",
                        "queryDropped": false,
                        "purpose": "Read docs.",
                        "approvedAt": 1
                    }
                }),
                &ToolContext::new(tempfile::tempdir().unwrap().path(), 1),
            )
            .await
            .unwrap();
        assert!(!out.success);
        assert_eq!(out.full["errorClass"], "resolved_ip_changed_at_fetch");
        assert_eq!(out.full["isEvidence"], false);
    }

    #[test]
    fn fetch_pin_matches_approved_ip_by_membership_not_order() {
        let approved = IpAddr::V4(std::net::Ipv4Addr::new(93, 184, 216, 34));
        let sibling = IpAddr::V4(std::net::Ipv4Addr::new(93, 184, 216, 35));
        let approval = WebFetchApproval {
            host: "example.com".to_string(),
            pinned_ip: approved,
            port: 443,
            scheme: "https".to_string(),
            path_hash: "abcd".to_string(),
            query_dropped: false,
            purpose: "Read docs.".to_string(),
            approved_at: 1,
        };
        // Multi-A / round-robin: same addresses, different order, approved IP still
        // present -> NOT a rebind (SEC-P2-2 fix: no spurious re-prompt).
        assert!(!fetch_pin_rebind_detected(
            &approval,
            "example.com",
            443,
            &[sibling, approved]
        ));
        // Approved IP no longer resolves for the host -> genuine rotation -> re-prompt.
        assert!(fetch_pin_rebind_detected(
            &approval,
            "example.com",
            443,
            &[sibling]
        ));
        // Host or port mismatch -> re-prompt.
        assert!(fetch_pin_rebind_detected(
            &approval,
            "evil.example",
            443,
            &[approved]
        ));
        assert!(fetch_pin_rebind_detected(
            &approval,
            "example.com",
            8443,
            &[approved]
        ));
    }

    #[tokio::test]
    async fn redirect_to_denied_ip_is_blocked_before_second_socket() {
        let resolver = MockResolver::with_answers(vec![(
            "blocked.example",
            vec![vec![IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 1))]],
        )]);
        let config = WebFetchConfig {
            policy: EgressPolicy { allow_http: true },
            total_deadline: Duration::from_secs(2),
            ..WebFetchConfig::default()
        };
        let tool = WebFetch::with_resolver(resolver, config);

        let err = tool
            .validate_redirect_location_before_socket(
                1,
                &reqwest::Url::parse("http://public.example/redirect").unwrap(),
                "http://blocked.example/internal",
            )
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            EgressBlockReason::RedirectToDeniedTarget { hop: 1, .. }
        ));
    }

    #[tokio::test]
    async fn read_bounded_body_aborts_when_wire_body_exceeds_cap() {
        let stream = futures::stream::iter(vec![
            Ok(Bytes::from(vec![b'a'; MAX_RESPONSE_BYTES as usize])),
            Ok(Bytes::from_static(b"!")),
        ]);

        let err = read_bounded_byte_stream(stream, MAX_RESPONSE_BYTES, 128)
            .await
            .unwrap_err();

        assert!(matches!(
            err,
            EgressBlockReason::ResponseTooLarge { cap_bytes } if cap_bytes == MAX_RESPONSE_BYTES
        ));
    }

    #[tokio::test]
    async fn total_deadline_stops_slow_response_without_waiting_for_read_timeout() {
        let config = WebFetchConfig {
            total_deadline: Duration::from_millis(30),
            connect_timeout: Duration::from_secs(1),
            read_timeout: Duration::from_secs(1),
            ..WebFetchConfig::default()
        };
        let resolver = Arc::new(SlowResolver {
            delay: Duration::from_millis(200),
            ip: public_ip(),
        });
        let tool = WebFetch::with_resolver(resolver, config);
        let prepared = json!({
            "url": "https://slow.example/",
            "purpose": "Read slow docs.",
            "web_fetch_approval": {
                "host": "slow.example",
                "pinnedIp": public_ip(),
                "port": 443,
                "scheme": "https",
                "pathHash": "abcd",
                "queryDropped": false,
                "purpose": "Read slow docs.",
                "approvedAt": 1
            }
        });
        let started = Instant::now();

        let out = tool
            .run(
                prepared,
                &ToolContext::new(tempfile::tempdir().unwrap().path(), 1),
            )
            .await
            .unwrap();

        assert!(!out.success);
        assert_eq!(out.full["errorClass"], "deadline_exceeded");
        assert_eq!(out.full["unavailableReason"], "timeout");
        assert!(
            started.elapsed() < Duration::from_millis(150),
            "deadline should stop before the delayed response finishes"
        );
    }

    #[test]
    fn session_grant_key_scopes_to_host_purpose_and_pinned_ip() {
        let base = json!({
            "url": "https://example.com/docs",
            "purpose": "Read docs.",
            "web_fetch_approval": {
                "host": "Example.com",
                "pinnedIp": public_ip(),
                "port": 443,
                "scheme": "HTTPS",
                "pathHash": "first",
                "queryDropped": false,
                "purpose": "Read docs.",
                "approvedAt": 1
            }
        });
        let mut same_host_different_path = base.clone();
        same_host_different_path["web_fetch_approval"]["pathHash"] = json!("second");
        same_host_different_path["url"] = json!("https://example.com/other");
        assert_eq!(
            session_grant_key(&base),
            session_grant_key(&same_host_different_path)
        );

        let mut different_purpose = base.clone();
        different_purpose["web_fetch_approval"]["purpose"] = json!("Read release notes.");
        assert_ne!(
            session_grant_key(&base),
            session_grant_key(&different_purpose)
        );

        let mut different_ip = base.clone();
        different_ip["web_fetch_approval"]["pinnedIp"] = json!("93.184.216.35");
        assert_ne!(session_grant_key(&base), session_grant_key(&different_ip));
    }

    #[test]
    fn offline_failure_reports_unavailable_status() {
        let out = web_fetch_failure_output(
            "https://example.invalid/",
            "Read docs.",
            EgressBlockReason::DnsResolutionFailed {
                host: "example.invalid".into(),
            },
            Instant::now(),
        );
        assert!(!out.success);
        assert_eq!(out.full["status"], "unavailable");
        assert_eq!(out.full["unavailableReason"], "offline");
    }

    #[test]
    fn client_profile_locks_custom_resolver_and_manual_redirect_policy() {
        let profile = client_profile();
        assert!(profile.custom_resolver);
        assert!(profile.redirect_policy_none);
        assert!(profile.transparent_decompression_disabled);
        assert_eq!(profile.max_response_bytes, MAX_RESPONSE_BYTES);
    }
}
