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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissingCriterionClass {
    Responsive,
    Persistence,
    Accessibility,
    Loading,
    Empty,
    Error,
}

impl MissingCriterionClass {
    pub fn label(&self, locale_is_en: bool) -> &'static str {
        match (self, locale_is_en) {
            (MissingCriterionClass::Responsive, true) => "responsive behavior",
            (MissingCriterionClass::Responsive, false) => "반응형 동작",
            (MissingCriterionClass::Persistence, true) => "persistence after reload",
            (MissingCriterionClass::Persistence, false) => "새로고침 후 유지",
            (MissingCriterionClass::Accessibility, true) => "keyboard/ARIA accessibility",
            (MissingCriterionClass::Accessibility, false) => "키보드/ARIA 접근성",
            (MissingCriterionClass::Loading, true) => "loading state",
            (MissingCriterionClass::Loading, false) => "로딩 상태",
            (MissingCriterionClass::Empty, true) => "empty state",
            (MissingCriterionClass::Empty, false) => "빈 상태",
            (MissingCriterionClass::Error, true) => "error state",
            (MissingCriterionClass::Error, false) => "오류 상태",
        }
    }
}

pub fn verification_type_from_legacy(command: Option<&str>) -> VerificationType {
    match command {
        Some(command) if legacy_command_looks_like_test(command) => VerificationType::Test,
        Some(command) if !command.trim().is_empty() => VerificationType::Run,
        _ => VerificationType::Manual,
    }
}

fn legacy_command_looks_like_test(command: &str) -> bool {
    let command = command.trim().to_ascii_lowercase();
    if command.is_empty() {
        return false;
    }
    let executable = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".exe");
    if matches!(executable, "cargo-nextest" | "jest" | "pytest" | "vitest") {
        return true;
    }
    command.split_whitespace().any(|token| {
        token == "test"
            || token.starts_with("test:")
            || token.ends_with(":test")
            || token == "test:unit"
    })
}

pub fn vague_terms(locale_is_en: bool) -> &'static [&'static str] {
    if locale_is_en {
        &[
            "something",
            "nice",
            "whatever",
            "good",
            "works",
            "clean",
            "polished",
            "intuitive",
            "smooth",
            "properly",
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
        "fetches",
        "fetching",
        "api",
        "load",
        "loads",
        "loaded",
        "request",
        "requests",
        "requested",
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
        "buttons",
        "page",
        "pages",
        "반응형",
        "모바일",
        "화면",
        "버튼",
    ]
}

pub const STATE_MARKERS: &[&str] = &[
    "state",
    "visible",
    "hidden",
    "shows",
    "displays",
    "appears",
    "updates",
    "selected",
    "disabled",
    "enabled",
    "loading",
    "empty",
    "error",
    "success",
    "succeeds",
    "failure",
    "fails",
    "saved",
    "persists",
    "persisted",
    "survives",
    "reload",
    "refresh",
    "sort",
    "sorts",
    "sorted",
    "parse",
    "parses",
    "parsed",
    "compute",
    "computes",
    "computed",
    "return",
    "returns",
    "returned",
    "validate",
    "validates",
    "validated",
    "calculate",
    "calculates",
    "calculated",
    "완료",
    "보임",
    "표시",
    "나타",
    "선택",
    "비활성",
    "활성",
    "로딩",
    "빈",
    "오류",
    "에러",
    "성공",
    "실패",
    "저장",
    "유지",
    "새로고침",
];

pub const RESPONSIVE_MARKERS: &[&str] = &[
    "responsive",
    "breakpoint",
    "desktop",
    "tablet",
    "mobile",
    "phone",
    "column",
    "columns",
    "grid",
    "width",
    "반응형",
    "브레이크포인트",
    "데스크톱",
    "태블릿",
    "모바일",
    "열",
    "그리드",
    "너비",
];

pub const PERSISTENCE_MARKERS: &[&str] = &[
    "persist",
    "persists",
    "persisted",
    "persisting",
    "persistence",
    "save",
    "saves",
    "saved",
    "saving",
    "reload",
    "reloads",
    "reloaded",
    "reloading",
    "refresh",
    "refreshes",
    "refreshed",
    "refreshing",
    "survive",
    "survives",
    "survived",
    "surviving",
    "localstorage",
    "storage",
    "저장",
    "유지",
    "새로고침",
    "재로드",
    "스토리지",
];

pub const ACCESSIBILITY_MARKERS: &[&str] = &[
    "accessibility",
    "a11y",
    "keyboard",
    "aria",
    "screen reader",
    "focus",
    "tab order",
    "접근성",
    "키보드",
    "스크린리더",
    "포커스",
];

pub const LOADING_STATE_MARKERS: &[&str] = &[
    "loading",
    "spinner",
    "skeleton",
    "pending",
    "while data loads",
    "while request",
    "로딩",
    "불러오는 중",
    "스피너",
    "스켈레톤",
    "대기",
];

pub const EMPTY_STATE_MARKERS: &[&str] = &[
    "empty",
    "no results",
    "no data",
    "zero",
    "none",
    "blank",
    "빈",
    "결과 없음",
    "데이터 없음",
    "없을 때",
];

pub const ERROR_STATE_MARKERS: &[&str] = &[
    "error",
    "failure",
    "failed",
    "retry",
    "network",
    "에러",
    "오류",
    "실패",
    "재시도",
    "네트워크",
];

pub fn criterion_class_is_covered(criteria_text: &str, class: MissingCriterionClass) -> bool {
    match class {
        MissingCriterionClass::Responsive => contains_any(criteria_text, RESPONSIVE_MARKERS),
        MissingCriterionClass::Persistence => contains_any(criteria_text, PERSISTENCE_MARKERS),
        MissingCriterionClass::Accessibility => contains_any(criteria_text, ACCESSIBILITY_MARKERS),
        MissingCriterionClass::Loading => contains_any(criteria_text, LOADING_STATE_MARKERS),
        MissingCriterionClass::Empty => contains_any(criteria_text, EMPTY_STATE_MARKERS),
        MissingCriterionClass::Error => contains_any(criteria_text, ERROR_STATE_MARKERS),
    }
}

pub fn criterion_classes(criterion_text: &str) -> Vec<MissingCriterionClass> {
    let normalized = normalize_quality_text(criterion_text);
    [
        MissingCriterionClass::Responsive,
        MissingCriterionClass::Persistence,
        MissingCriterionClass::Accessibility,
        MissingCriterionClass::Loading,
        MissingCriterionClass::Empty,
        MissingCriterionClass::Error,
    ]
    .into_iter()
    .filter(|class| criterion_class_is_covered(&normalized, *class))
    .collect()
}

pub fn contains_any(value: &str, needles: &[&str]) -> bool {
    let normalized_value = normalize_quality_text(value);
    needles.iter().any(|needle| {
        let needle = normalize_quality_text(needle);
        quality_marker_matches(&normalized_value, &needle)
    })
}

fn normalize_quality_text(value: &str) -> String {
    value.to_lowercase()
}

fn quality_marker_matches(value: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    if needle.chars().any(|ch| ch.is_whitespace()) {
        return value.contains(needle);
    }
    if needle.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return value
            .split(|ch: char| !ch.is_ascii_alphanumeric())
            .any(|token| token == needle);
    }
    if needle.chars().all(is_hangul_char) {
        if needle.chars().count() == 1 {
            return value
                .split(|ch| !is_hangul_char(ch))
                .any(|token| token == needle);
        }
        return value.contains(needle);
    }
    value.contains(needle)
}

fn is_hangul_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F
    )
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
    fn legacy_command_maps_to_test_when_command_is_test_like() {
        assert_eq!(
            verification_type_from_legacy(Some("npm test")),
            VerificationType::Test
        );
    }

    #[test]
    fn legacy_command_maps_to_run_when_command_is_not_test_like() {
        assert_eq!(
            verification_type_from_legacy(Some("npm run build")),
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

    #[test]
    fn criterion_classes_returns_every_matching_class() {
        assert_eq!(
            criterion_classes("resize to 375px, columns collapse"),
            vec![MissingCriterionClass::Responsive]
        );
        assert_eq!(
            criterion_classes("survives reload"),
            vec![MissingCriterionClass::Persistence]
        );
        assert_eq!(
            criterion_classes("tab focus ARIA"),
            vec![MissingCriterionClass::Accessibility]
        );
        assert_eq!(
            criterion_classes("loading spinner / empty / error+retry"),
            vec![
                MissingCriterionClass::Loading,
                MissingCriterionClass::Empty,
                MissingCriterionClass::Error
            ]
        );
        assert_eq!(
            criterion_classes(
                "Build a responsive page that fetches API data with loading spinner, empty state, and error retry."
            ),
            vec![
                MissingCriterionClass::Responsive,
                MissingCriterionClass::Loading,
                MissingCriterionClass::Empty,
                MissingCriterionClass::Error
            ]
        );
        assert!(criterion_classes("plays a sound").is_empty());
    }
}
