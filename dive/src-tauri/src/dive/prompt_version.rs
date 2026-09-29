//! Prompt versions for LLM-backed supervision surfaces (spec 015 FR-001).
//!
//! Every surface that sends a prompt to a model (SupervisorAgent, verification
//! coach, PRD interview) records a `promptVersion` of the form
//! `<semver>+<8-hex>` in its evaluation event. The semver is a hand-maintained
//! const next to the builder; the hash is computed from the builder's rendered
//! template text with placeholders in place of per-request data. A pin test per
//! surface (`assert_prompt_version_pinned`) fails when the template text
//! changes without the semver changing, so every prompt edit is a visible,
//! versioned release (D-015-01).

use sha2::{Digest, Sha256};

/// Length of the hex template hash suffix in a rendered `promptVersion`.
pub const TEMPLATE_HASH_HEX_LEN: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptVersion {
    pub surface: &'static str,
    pub semver: &'static str,
    pub template_hash: String,
}

impl PromptVersion {
    pub fn new(surface: &'static str, semver: &'static str, fingerprint: &str) -> Self {
        Self {
            surface,
            semver,
            template_hash: template_hash(fingerprint),
        }
    }

    /// `<semver>+<8-hex>` — the value logged as `promptVersion`.
    pub fn render(&self) -> String {
        format!("{}+{}", self.semver, self.template_hash)
    }
}

/// First eight hex characters of the SHA-256 of the template fingerprint.
pub fn template_hash(fingerprint: &str) -> String {
    let digest = Sha256::digest(fingerprint.as_bytes());
    format!("{digest:x}")[..TEMPLATE_HASH_HEX_LEN].to_string()
}

/// Pin-test helper shared by every surface. `history` lists each released
/// `(semver, template_hash)` pair, oldest first; the last entry is the
/// current release. Editing a template changes its hash, so the author must
/// append a new entry with a bumped semver — rewriting an existing entry's
/// hash under the same semver is rejected because semvers must stay unique
/// and each one maps to exactly one template.
#[cfg(test)]
pub(crate) fn assert_prompt_version_pinned(version: &PromptVersion, history: &[(&str, &str)]) {
    let semvers = history
        .iter()
        .map(|(semver, _)| *semver)
        .collect::<Vec<_>>();
    let mut unique_semvers = semvers.clone();
    unique_semvers.sort_unstable();
    unique_semvers.dedup();
    assert_eq!(
        unique_semvers.len(),
        semvers.len(),
        "{} prompt version history repeats a semver: {semvers:?}",
        version.surface
    );
    let hashes = history.iter().map(|(_, hash)| *hash).collect::<Vec<_>>();
    let mut unique_hashes = hashes.clone();
    unique_hashes.sort_unstable();
    unique_hashes.dedup();
    assert_eq!(
        unique_hashes.len(),
        hashes.len(),
        "{} prompt version history reuses a template hash under two semvers: {hashes:?}",
        version.surface
    );
    let (pinned_semver, pinned_hash) = history
        .last()
        .copied()
        .expect("prompt version history has at least one release");
    assert_eq!(
        (version.semver, version.template_hash.as_str()),
        (pinned_semver, pinned_hash),
        "The {} prompt template changed (current hash {}). Bump its PROMPT_SEMVER and append \
         (\"<new semver>\", \"{}\") to the pinned history — never edit an existing entry.",
        version.surface,
        version.template_hash,
        version.template_hash,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_joins_semver_and_eight_hex_hash() {
        let version = PromptVersion::new("test", "1.2.3", "template {placeholder}");
        let rendered = version.render();
        let (semver, hash) = rendered.split_once('+').unwrap();
        assert_eq!(semver, "1.2.3");
        assert_eq!(hash.len(), TEMPLATE_HASH_HEX_LEN);
        assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn template_hash_is_stable_and_sensitive_to_text() {
        assert_eq!(template_hash("a"), template_hash("a"));
        assert_ne!(template_hash("a"), template_hash("a "));
        // SHA-256("abc") = ba7816bf...
        assert_eq!(template_hash("abc"), "ba7816bf");
    }

    #[test]
    fn pin_helper_accepts_matching_history() {
        let version = PromptVersion::new("test", "1.1.0", "v2");
        assert_prompt_version_pinned(
            &version,
            &[
                ("1.0.0", template_hash("v1").as_str()),
                ("1.1.0", template_hash("v2").as_str()),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "Bump its PROMPT_SEMVER")]
    fn pin_helper_rejects_template_change_without_semver_bump() {
        let version = PromptVersion::new("test", "1.0.0", "edited template");
        assert_prompt_version_pinned(&version, &[("1.0.0", template_hash("original").as_str())]);
    }

    #[test]
    #[should_panic(expected = "repeats a semver")]
    fn pin_helper_rejects_rewritten_history() {
        let version = PromptVersion::new("test", "1.0.0", "v2");
        assert_prompt_version_pinned(
            &version,
            &[
                ("1.0.0", template_hash("v1").as_str()),
                ("1.0.0", template_hash("v2").as_str()),
            ],
        );
    }
}
