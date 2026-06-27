#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationType {
    Run,
    Preview,
    Manual,
    Test,
}

impl VerificationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            VerificationType::Run => "run",
            VerificationType::Preview => "preview",
            VerificationType::Manual => "manual",
            VerificationType::Test => "test",
        }
    }

    pub fn from_str_opt(s: Option<&str>) -> Option<VerificationType> {
        match s?.trim().to_ascii_lowercase().as_str() {
            "run" => Some(VerificationType::Run),
            "preview" => Some(VerificationType::Preview),
            "manual" => Some(VerificationType::Manual),
            "test" => Some(VerificationType::Test),
            _ => None,
        }
    }
}

pub fn verification_type_from_legacy(command: Option<&str>) -> VerificationType {
    match command {
        Some(command) if !command.trim().is_empty() => VerificationType::Run,
        _ => VerificationType::Manual,
    }
}

pub fn vague_terms(locale_is_en: bool) -> &'static [&'static str] {
    if locale_is_en {
        &[
            "something",
            "nice",
            "whatever",
            "good",
            "simple",
            "stuff",
            "make it nice",
            "like other",
        ]
    } else {
        &[
            "이거",
            "그거",
            "저거",
            "이것",
            "그것",
            "저것",
            "그걸",
            "이걸",
            "저번",
            "지난번",
            "방금",
            "아까",
            "뭔가",
            "어떤 거",
            "어떤거",
            "그런 식",
            "그런식",
            "그런 거",
            "그런거",
            "적당히",
            "대충",
            "여러",
            "지워줘",
            "삭제해줘",
            "없애줘",
            "고쳐줘",
            "수정해줘",
            "바꿔줘",
            "만들어줘",
            "추가해줘",
        ]
    }
}

pub fn data_fetch_keywords() -> &'static [&'static str] {
    &[
        "fetch",
        "api",
        "load",
        "request",
        "endpoint",
        "데이터",
        "불러",
        "요청",
    ]
}

pub fn ui_goal_keywords() -> &'static [&'static str] {
    &[
        "responsive",
        "mobile",
        "layout",
        "button",
        "page",
        "반응형",
        "모바일",
        "화면",
        "버튼",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_type_serde_round_trips_all_variants() {
        for verification_type in [
            VerificationType::Run,
            VerificationType::Preview,
            VerificationType::Manual,
            VerificationType::Test,
        ] {
            let encoded = serde_json::to_string(&verification_type).expect("serialize");
            assert_eq!(encoded, format!("\"{}\"", verification_type.as_str()));
            let decoded: VerificationType = serde_json::from_str(&encoded).expect("deserialize");
            assert_eq!(decoded, verification_type);
        }
    }

    #[test]
    fn legacy_command_maps_to_run() {
        assert_eq!(
            verification_type_from_legacy(Some("npm test")),
            VerificationType::Run
        );
    }

    #[test]
    fn missing_legacy_command_maps_to_manual() {
        assert_eq!(
            verification_type_from_legacy(None),
            VerificationType::Manual
        );
    }

    #[test]
    fn unknown_verification_type_string_returns_none() {
        assert_eq!(VerificationType::from_str_opt(Some("bogus")), None);
    }
}
