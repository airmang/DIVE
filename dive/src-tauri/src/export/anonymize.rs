use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub fn hash_with_salt(input: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let hex = format!("{:x}", digest);
    hex[..16].to_string()
}

pub fn hash_text(input: &str, salt: &str) -> Value {
    Value::String(format!("h:{}", hash_with_salt(input, salt)))
}

pub fn hash_path(input: &str, salt: &str) -> Value {
    Value::String(format!("p:{}", hash_with_salt(input, salt)))
}

pub fn hash_id(kind: &str, id: i64, salt: &str) -> Value {
    Value::String(format!(
        "id:{kind}:{}",
        hash_with_salt(&format!("{kind}:{id}"), salt)
    ))
}

pub fn maybe_hash_id(enabled: bool, kind: &str, id: i64, salt: &str) -> Value {
    if enabled {
        hash_id(kind, id, salt)
    } else {
        Value::Number(id.into())
    }
}

pub fn maybe_hash_text(enabled: bool, input: &str, salt: &str) -> Value {
    if enabled {
        hash_text(input, salt)
    } else {
        Value::String(input.to_string())
    }
}

pub fn anonymize_value(
    value: &Value,
    hash_user_text: bool,
    hash_file_paths: bool,
    salt: &str,
) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, nested) in map {
                let anonymized = if hash_file_paths && looks_like_path_key(key) {
                    hash_path_like(nested, salt)
                } else if hash_user_text && looks_like_user_text_key(key) {
                    hash_text_like(nested, salt)
                } else {
                    anonymize_value(nested, hash_user_text, hash_file_paths, salt)
                };
                out.insert(key.clone(), anonymized);
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|nested| anonymize_value(nested, hash_user_text, hash_file_paths, salt))
                .collect(),
        ),
        Value::String(s) if hash_file_paths && looks_like_path_value(s) => hash_path(s, salt),
        Value::String(s) if hash_user_text && contains_pii(s) => hash_text(s, salt),
        other => other.clone(),
    }
}

pub fn contains_pii(s: &str) -> bool {
    contains_email(s)
        || contains_phone_like_number(s)
        || s.contains("학번")
        || s.contains("학생-")
        || s.contains("student-")
        || s.contains("sk-")
}

fn contains_email(s: &str) -> bool {
    s.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '(' | ')' | ','))
        .any(|token| {
            let Some((local, domain)) = token.split_once('@') else {
                return false;
            };
            !local.is_empty() && domain.contains('.') && domain.len() >= 3
        })
}

fn contains_phone_like_number(s: &str) -> bool {
    let digits = s.chars().filter(|c| c.is_ascii_digit()).count();
    digits >= 10 && (s.contains('-') || s.contains(' ') || s.starts_with("010"))
}

pub fn looks_like_path_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    matches!(
        key.as_str(),
        "path"
            | "paths"
            | "file"
            | "files"
            | "filename"
            | "filenames"
            | "file_path"
            | "file_paths"
            | "target_path"
            | "target_paths"
            | "changedfiles"
            | "highriskfiles"
    )
}

pub fn looks_like_path_value(s: &str) -> bool {
    let has_sep = s.contains('/') || s.contains('\\');
    let ext = [
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".c", ".cpp", ".h", ".json",
        ".toml", ".md", ".html", ".css", ".scss", ".svg",
    ]
    .iter()
    .any(|e| s.ends_with(e));
    let well_known_file = matches!(
        s.to_ascii_lowercase().as_str(),
        "package.json"
            | "pnpm-lock.yaml"
            | "package-lock.json"
            | "yarn.lock"
            | "cargo.toml"
            | "cargo.lock"
    );
    (has_sep && ext) || well_known_file
}

pub fn looks_like_user_text_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    matches!(
        key.as_str(),
        "reason"
            | "riskreason"
            | "risk_reason"
            | "note"
            | "message"
            | "prompt"
            | "promptbody"
            | "prompt_body"
            | "transcript"
            | "transcriptbody"
            | "transcript_body"
            | "sourcecode"
            | "source_code"
            | "code"
            | "content"
            | "body"
            | "raw"
            | "rawtext"
            | "raw_text"
            | "text"
    )
}

fn hash_path_like(value: &Value, salt: &str) -> Value {
    match value {
        Value::String(s) => hash_path(s, salt),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| hash_path_like(item, salt))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, nested) in map {
                out.insert(key.clone(), hash_path_like(nested, salt));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn hash_text_like(value: &Value, salt: &str) -> Value {
    match value {
        Value::String(s) => hash_text(s, salt),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| hash_text_like(item, salt))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, nested) in map {
                out.insert(key.clone(), hash_text_like(nested, salt));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hash_is_stable_for_same_salt() {
        let a = hash_with_salt("hello", "salt");
        let b = hash_with_salt("hello", "salt");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn hash_differs_across_salts() {
        let a = hash_with_salt("hello", "salt-a");
        let b = hash_with_salt("hello", "salt-b");
        assert_ne!(a, b);
    }

    #[test]
    fn path_detector_identifies_filenames() {
        assert!(looks_like_path_value("src/App.tsx"));
        assert!(looks_like_path_value("C:\\Users\\x\\a.rs"));
        assert!(!looks_like_path_value("hello world"));
        assert!(!looks_like_path_value(".rs"));
    }

    #[test]
    fn anonymize_value_masks_paths_and_pii() {
        let salt = "s";
        let v = json!({
            "path": "src/a.tsx",
            "count": 3,
            "nested": { "file": "b.rs", "note": "email a@example.com" },
            "items": ["src/c.ts", "plain"]
        });
        let out = anonymize_value(&v, true, true, salt);
        assert!(out["path"].as_str().unwrap().starts_with("p:"));
        assert!(out["nested"]["file"].as_str().unwrap().starts_with("p:"));
        assert!(out["nested"]["note"].as_str().unwrap().starts_with("h:"));
        assert!(out["items"][0].as_str().unwrap().starts_with("p:"));
        assert_eq!(out["items"][1], Value::String("plain".into()));
        assert_eq!(out["count"], json!(3));
    }

    #[test]
    fn pii_detector_covers_common_classroom_identifiers() {
        assert!(contains_pii("student@example.edu"));
        assert!(contains_pii("010-1234-5678"));
        assert!(contains_pii("학번 20261234"));
        assert!(contains_pii("학생-42"));
        assert!(contains_pii("sk-secret"));
        assert!(!contains_pii("ordinary note"));
    }
}
