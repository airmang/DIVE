use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;

const DEFAULT_HTTPS_PORT: u16 = 443;
const DEFAULT_HTTP_PORT: u16 = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EgressScheme {
    Https,
    Http,
}

impl EgressScheme {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Https => "https",
            Self::Http => "http",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EgressTarget {
    pub url: String,
    pub host: String,
    pub port: u16,
    pub scheme: EgressScheme,
    pub path_hash: String,
    pub query_dropped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal_ip: Option<IpAddr>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedTarget {
    pub host: String,
    pub pinned_ip: IpAddr,
    pub port: u16,
    pub scheme: EgressScheme,
    pub path_hash: String,
    pub query_dropped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgressBlockReason {
    DisallowedScheme {
        scheme: String,
    },
    EmbeddedCredentials,
    NonAbsoluteUrl,
    ZoneIdInHost,
    NonCanonicalIpLiteral {
        host: String,
    },
    DnsResolutionFailed {
        host: String,
    },
    // S-064: distinct transport failures. DNS already succeeded by the time the
    // socket send runs, so folding connect/timeout/tls failures into
    // `DnsResolutionFailed` misreported them as "offline / host could not be
    // resolved".
    ConnectionFailed {
        host: String,
    },
    RequestTimeout {
        host: String,
    },
    TlsError {
        host: String,
    },
    TransportFailed {
        host: String,
    },
    DeniedResolvedIp {
        host: String,
        ip: IpAddr,
        rule: String,
    },
    RedirectToDeniedTarget {
        hop: u8,
        ip: IpAddr,
        rule: String,
    },
    TooManyRedirects,
    ResolvedIpChangedAtFetch {
        host: String,
        approved_ip: IpAddr,
        resolved_ip: IpAddr,
    },
    ResponseTooLarge {
        cap_bytes: u64,
    },
    DeadlineExceeded,
    NonGetMethodDenied {
        method: String,
    },
    HostNotAllowlisted {
        host: String,
    },
}

impl EgressBlockReason {
    pub fn code(&self) -> &'static str {
        match self {
            Self::DisallowedScheme { .. } => "disallowed_scheme",
            Self::EmbeddedCredentials => "embedded_credentials",
            Self::NonAbsoluteUrl => "non_absolute_url",
            Self::ZoneIdInHost => "zone_id_in_host",
            Self::NonCanonicalIpLiteral { .. } => "non_canonical_ip_literal",
            Self::DnsResolutionFailed { .. } => "dns_resolution_failed",
            Self::ConnectionFailed { .. } => "connection_failed",
            Self::RequestTimeout { .. } => "request_timeout",
            Self::TlsError { .. } => "tls_error",
            Self::TransportFailed { .. } => "transport_failed",
            Self::DeniedResolvedIp { .. } => "denied_resolved_ip",
            Self::RedirectToDeniedTarget { .. } => "redirect_to_denied_target",
            Self::TooManyRedirects => "too_many_redirects",
            Self::ResolvedIpChangedAtFetch { .. } => "resolved_ip_changed_at_fetch",
            Self::ResponseTooLarge { .. } => "response_too_large",
            Self::DeadlineExceeded => "deadline_exceeded",
            Self::NonGetMethodDenied { .. } => "non_get_method_denied",
            Self::HostNotAllowlisted { .. } => "host_not_allowlisted",
        }
    }

    pub fn safe_agent_message(&self) -> &'static str {
        match self {
            Self::DeadlineExceeded => "web fetch stopped because the response took too long",
            Self::ResponseTooLarge { .. } => "web fetch stopped because the response was too large",
            Self::DnsResolutionFailed { .. } => {
                "web fetch unavailable because the host could not be resolved"
            }
            Self::ConnectionFailed { .. } => {
                "web fetch unavailable because the host could not be reached"
            }
            Self::RequestTimeout { .. } => "web fetch stopped because the request timed out",
            Self::TlsError { .. } => {
                "web fetch blocked because the host's TLS connection could not be verified"
            }
            Self::TransportFailed { .. } => "web fetch failed due to a network error",
            _ => "web fetch blocked by safety policy",
        }
    }

    pub fn unavailable_reason(&self) -> WebUnavailableReason {
        match self {
            Self::DeadlineExceeded => WebUnavailableReason::Timeout,
            Self::RequestTimeout { .. } => WebUnavailableReason::Timeout,
            Self::DnsResolutionFailed { .. } => WebUnavailableReason::Offline,
            Self::ConnectionFailed { .. } => WebUnavailableReason::Offline,
            Self::TransportFailed { .. } => WebUnavailableReason::Offline,
            Self::TlsError { .. } => WebUnavailableReason::BlockedTarget,
            Self::ResponseTooLarge { .. } => WebUnavailableReason::Timeout,
            Self::DisallowedScheme { .. }
            | Self::EmbeddedCredentials
            | Self::NonAbsoluteUrl
            | Self::ZoneIdInHost
            | Self::NonCanonicalIpLiteral { .. }
            | Self::DeniedResolvedIp { .. }
            | Self::RedirectToDeniedTarget { .. }
            | Self::TooManyRedirects
            | Self::ResolvedIpChangedAtFetch { .. }
            | Self::NonGetMethodDenied { .. }
            | Self::HostNotAllowlisted { .. } => WebUnavailableReason::BlockedTarget,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebUnavailableReason {
    Offline,
    EgressDenied,
    Timeout,
    BlockedTarget,
}

impl WebUnavailableReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::EgressDenied => "egress_denied",
            Self::Timeout => "timeout",
            Self::BlockedTarget => "blocked_target",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EgressPolicy {
    pub allow_http: bool,
}

pub fn classify_egress_url(
    raw: &str,
    policy: EgressPolicy,
) -> Result<EgressTarget, EgressBlockReason> {
    let raw_host = raw_host_token(raw).ok_or(EgressBlockReason::NonAbsoluteUrl)?;
    validate_raw_host_token(&raw_host)?;

    let url = reqwest::Url::parse(raw).map_err(|_| EgressBlockReason::NonAbsoluteUrl)?;
    if !url.has_host() {
        return Err(EgressBlockReason::NonAbsoluteUrl);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(EgressBlockReason::EmbeddedCredentials);
    }
    let scheme = match url.scheme() {
        "https" => EgressScheme::Https,
        "http" if policy.allow_http => EgressScheme::Http,
        other => {
            return Err(EgressBlockReason::DisallowedScheme {
                scheme: other.to_string(),
            })
        }
    };
    let host = url
        .host_str()
        .ok_or(EgressBlockReason::NonAbsoluteUrl)?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    let literal_ip = IpAddr::from_str(&host).ok();
    if let Some(ip) = literal_ip {
        validate_ip_allowed(&host, ip)?;
    }
    let port = url.port().unwrap_or_else(|| {
        if scheme == EgressScheme::Https {
            DEFAULT_HTTPS_PORT
        } else {
            DEFAULT_HTTP_PORT
        }
    });
    let query_dropped = url.query().is_some();
    Ok(EgressTarget {
        url: url.to_string(),
        host,
        port,
        scheme,
        path_hash: short_hash(url.path()),
        query_dropped,
        literal_ip,
    })
}

pub fn validate_resolved_target(
    target: &EgressTarget,
    ips: &[IpAddr],
) -> Result<ValidatedTarget, EgressBlockReason> {
    if ips.is_empty() {
        return Err(EgressBlockReason::DnsResolutionFailed {
            host: target.host.clone(),
        });
    }
    for ip in ips {
        validate_ip_allowed(&target.host, *ip)?;
    }
    let pinned_ip = ips[0];
    Ok(ValidatedTarget {
        host: target.host.clone(),
        pinned_ip,
        port: target.port,
        scheme: target.scheme,
        path_hash: target.path_hash.clone(),
        query_dropped: target.query_dropped,
    })
}

pub fn validate_redirect_target(
    hop: u8,
    target: &EgressTarget,
    ips: &[IpAddr],
) -> Result<ValidatedTarget, EgressBlockReason> {
    match validate_resolved_target(target, ips) {
        Ok(validated) => Ok(validated),
        Err(EgressBlockReason::DeniedResolvedIp { ip, rule, .. }) => {
            Err(EgressBlockReason::RedirectToDeniedTarget { hop, ip, rule })
        }
        Err(other) => Err(other),
    }
}

pub fn validate_ip_allowed(host: &str, ip: IpAddr) -> Result<(), EgressBlockReason> {
    if let Some(rule) = denied_ip_rule(ip) {
        return Err(EgressBlockReason::DeniedResolvedIp {
            host: host.to_string(),
            ip,
            rule: rule.to_string(),
        });
    }
    Ok(())
}

pub fn denied_ip_rule(ip: IpAddr) -> Option<&'static str> {
    match ip {
        IpAddr::V4(v4) => denied_ipv4_rule(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = embedded_ipv4(v6) {
                return denied_ipv4_rule(v4).map(|_| "embedded denied IPv4 address");
            }
            denied_ipv6_rule(v6)
        }
    }
}

fn denied_ipv4_rule(ip: Ipv4Addr) -> Option<&'static str> {
    let [a, b, c, d] = ip.octets();
    if a == 0 {
        return Some("this-network 0.0.0.0/8");
    }
    if a == 10 {
        return Some("private 10.0.0.0/8");
    }
    if a == 127 {
        return Some("loopback 127.0.0.0/8");
    }
    if a == 169 && b == 254 {
        return Some("link-local 169.254.0.0/16");
    }
    if a == 172 && (16..=31).contains(&b) {
        return Some("private 172.16.0.0/12");
    }
    if a == 192 && b == 168 {
        return Some("private 192.168.0.0/16");
    }
    if a == 100 && (64..=127).contains(&b) {
        return Some("carrier-grade nat 100.64.0.0/10");
    }
    if a == 192 && b == 0 && c == 0 {
        return Some("ietf protocol assignment 192.0.0.0/24");
    }
    if a == 192 && b == 0 && c == 2 {
        return Some("test-net 192.0.2.0/24");
    }
    if a == 198 && (b == 18 || b == 19) {
        return Some("benchmark 198.18.0.0/15");
    }
    if a == 198 && b == 51 && c == 100 {
        return Some("test-net 198.51.100.0/24");
    }
    if a == 203 && b == 0 && c == 113 {
        return Some("test-net 203.0.113.0/24");
    }
    if (224..=239).contains(&a) {
        return Some("multicast 224.0.0.0/4");
    }
    if a >= 240 {
        return Some("reserved 240.0.0.0/4");
    }
    if [a, b, c, d] == [255, 255, 255, 255] {
        return Some("limited broadcast");
    }
    None
}

fn denied_ipv6_rule(ip: Ipv6Addr) -> Option<&'static str> {
    let segments = ip.segments();
    if ip.is_loopback() {
        return Some("loopback ::1/128");
    }
    if ip.is_unspecified() {
        return Some("unspecified ::/128");
    }
    if segments[0] & 0xffc0 == 0xfe80 {
        return Some("link-local fe80::/10");
    }
    if segments[0] & 0xfe00 == 0xfc00 {
        return Some("unique-local fc00::/7");
    }
    if segments[0] & 0xff00 == 0xff00 {
        return Some("multicast ff00::/8");
    }
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        return Some("documentation 2001:db8::/32");
    }
    if ip == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254) {
        return Some("aws metadata fd00:ec2::254");
    }
    None
}

fn embedded_ipv4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    let s = ip.segments();
    let low_v4 = || Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8);

    // ::ffff:0:0/96 IPv4-mapped
    if s[0..5] == [0, 0, 0, 0, 0] && s[5] == 0xffff {
        return Some(low_v4());
    }
    // ::/96 IPv4-compatible, excluding :: and ::1 which are covered above.
    if s[0..6] == [0, 0, 0, 0, 0, 0] && (s[6] != 0 || s[7] > 1) {
        return Some(low_v4());
    }
    // 64:ff9b::/96 NAT64 well-known prefix.
    if s[0] == 0x0064 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
        return Some(low_v4());
    }
    // 2002::/16 6to4 carries IPv4 in the next 32 bits.
    if s[0] == 0x2002 {
        return Some(Ipv4Addr::new(
            (s[1] >> 8) as u8,
            s[1] as u8,
            (s[2] >> 8) as u8,
            s[2] as u8,
        ));
    }
    // 2001::/32 Teredo obfuscates the client IPv4 in the final 32 bits.
    if s[0] == 0x2001 && s[1] == 0 {
        let obfuscated = low_v4().octets();
        return Some(Ipv4Addr::new(
            !obfuscated[0],
            !obfuscated[1],
            !obfuscated[2],
            !obfuscated[3],
        ));
    }
    None
}

fn raw_host_token(raw: &str) -> Option<String> {
    let scheme_sep = raw.find("://")?;
    let rest = &raw[scheme_sep + 3..];
    if rest.is_empty() {
        return None;
    }
    if let Some(stripped) = rest.strip_prefix('[') {
        let end = stripped.find(']')?;
        return Some(stripped[..end].to_string());
    }
    let end = rest.find([':', '/', '?', '#']).unwrap_or(rest.len());
    Some(rest[..end].to_string())
}

fn validate_raw_host_token(raw_host: &str) -> Result<(), EgressBlockReason> {
    if raw_host.contains('%') {
        return Err(EgressBlockReason::ZoneIdInHost);
    }
    let host = raw_host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(EgressBlockReason::NonCanonicalIpLiteral { host });
    }
    if host.contains("0x") {
        return Err(EgressBlockReason::NonCanonicalIpLiteral { host });
    }
    let dotted = host.split('.').collect::<Vec<_>>();
    if dotted
        .iter()
        .all(|part| part.chars().all(|ch| ch.is_ascii_digit()))
    {
        if dotted.len() < 4 {
            return Err(EgressBlockReason::NonCanonicalIpLiteral { host });
        }
        if dotted
            .iter()
            .any(|part| part.len() > 1 && part.starts_with('0'))
        {
            return Err(EgressBlockReason::NonCanonicalIpLiteral { host });
        }
    }
    Ok(())
}

pub fn safe_url_log_parts(raw: &str) -> ValueLogParts {
    match reqwest::Url::parse(raw) {
        Ok(url) => ValueLogParts {
            scheme: url.scheme().to_string(),
            host: url.host_str().unwrap_or("").to_string(),
            port: url.port_or_known_default(),
            path_hash: short_hash(url.path()),
            query_dropped: url.query().is_some(),
        },
        Err(_) => ValueLogParts {
            scheme: String::new(),
            host: String::new(),
            port: None,
            path_hash: short_hash(raw),
            query_dropped: raw.contains('?'),
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueLogParts {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub path_hash: String,
    pub query_dropped: bool,
}

pub fn short_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    hex[..16].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dangerous_schemes_credentials_and_non_canonical_literals() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/file",
            "https://user:pass@example.com/",
            "https://2130706433/",
            "https://0x7f000001/",
            "https://0177.0.0.1/",
            "https://127.1/",
            "https://[fe80::1%25lo0]/",
        ] {
            assert!(
                classify_egress_url(url, EgressPolicy::default()).is_err(),
                "url should be rejected: {url}"
            );
        }
    }

    #[test]
    fn defaults_to_https_only() {
        let err = classify_egress_url("http://example.com/", EgressPolicy::default()).unwrap_err();
        assert_eq!(err.code(), "disallowed_scheme");
        let allowed =
            classify_egress_url("http://example.com/", EgressPolicy { allow_http: true }).unwrap();
        assert_eq!(allowed.scheme, EgressScheme::Http);
        assert_eq!(allowed.port, 80);
    }

    #[test]
    fn blocks_internal_literals_and_ipv6_embeddings() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "::1",
            "::ffff:127.0.0.1",
            "64:ff9b::7f00:1",
            "2002:7f00:0001::",
            "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
        ] {
            let host = ip.trim_matches(['[', ']']);
            let parsed = IpAddr::from_str(host).expect("valid ip literal");
            assert!(denied_ip_rule(parsed).is_some(), "{ip} must be denied");
        }
    }

    #[test]
    fn blocks_mixed_dns_answers_fail_closed() {
        let target =
            classify_egress_url("https://example.com/docs", EgressPolicy::default()).unwrap();
        let err = validate_resolved_target(
            &target,
            &[
                IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
                IpAddr::V6(Ipv6Addr::LOCALHOST),
            ],
        )
        .unwrap_err();
        assert_eq!(err.code(), "denied_resolved_ip");
    }

    #[test]
    fn safe_log_parts_drop_query_and_hash_path() {
        let parts = safe_url_log_parts("https://example.com/reset/token-123?code=secret");
        assert_eq!(parts.host, "example.com");
        assert!(parts.query_dropped);
        assert_eq!(parts.path_hash.len(), 16);
    }
}
