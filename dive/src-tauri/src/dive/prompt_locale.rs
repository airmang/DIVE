pub fn prompt_locale_is_english(locale: &str) -> bool {
    let locale = locale.trim();
    if locale.is_empty() {
        return false;
    }
    locale.to_ascii_lowercase().starts_with("en")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_locale_is_english_matches_prompt_branching() {
        assert!(prompt_locale_is_english("en"));
        assert!(prompt_locale_is_english("EN-US"));
        assert!(!prompt_locale_is_english(""));
        assert!(!prompt_locale_is_english("ko"));
    }
}
