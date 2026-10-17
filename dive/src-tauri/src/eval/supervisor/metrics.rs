//! The eval metrics — the single definition of every check and aggregate in the
//! report (FR-032). `dive/eval/supervisor/README.md` documents them and
//! `scripts/eval-report.mjs` only renders what this module computes.

use std::collections::BTreeMap;

use super::report::{
    AttemptStats, Checks, CriterionLinkage, DecisionSummary, DropReasonMatch, EvalResult,
    EvidencePrecision, LocaleCompliance, OutcomeCounts, ProvokeAgreement, QuestionLength,
    ReportGroup,
};
use super::FixtureExpect;
use crate::dive::supervisor::{
    locale_is_english, SupervisorDropReason, SupervisorValidationOutcome, QUESTION_MAX_CHARS,
};

/// Per-result checks. `None` means the check does not apply to this result.
pub(crate) fn checks_for(
    expect: &FixtureExpect,
    outcome: SupervisorValidationOutcome,
    drop_reason: Option<SupervisorDropReason>,
    decision: Option<&DecisionSummary>,
) -> Checks {
    let shown = outcome == SupervisorValidationOutcome::Shown;
    // Shown questions only: they are what a student would see.
    let shown_decision = decision.filter(|_| shown);
    let question = shown_decision.map(|decision| decision.question.as_str());
    let cited = shown_decision.map(|decision| decision.evidence_ref_ids.as_slice());
    Checks {
        provoke_agreement: expect
            .expected_drop_reason
            .is_none()
            .then_some(shown == expect.should_provoke),
        drop_reason_match: expect
            .expected_drop_reason
            .map(|expected| drop_reason == Some(expected)),
        locale_compliant: question.map(|q| locale_compliant(&expect.locale, q)),
        criterion_linked: question.and_then(|q| {
            let terms = expect.criterion_terms.as_ref()?;
            let q = q.to_lowercase();
            Some(terms.iter().any(|term| q.contains(&term.to_lowercase())))
        }),
        evidence_precision: cited.and_then(|cited| {
            let relevant = expect.relevant_evidence_ref_ids.as_ref()?;
            (!cited.is_empty()).then(|| {
                cited.iter().filter(|id| relevant.contains(id)).count() as f64 / cited.len() as f64
            })
        }),
        required_evidence_cited: cited.and_then(|cited| {
            (!expect.required_evidence_ref_ids.is_empty()).then(|| {
                cited
                    .iter()
                    .any(|id| expect.required_evidence_ref_ids.contains(id))
            })
        }),
        question_chars: question.map(|q| q.chars().count()),
    }
}

/// Korean locales need at least one Hangul syllable; English ones none.
pub(crate) fn locale_compliant(locale: &str, question: &str) -> bool {
    let has_hangul = question
        .chars()
        .any(|ch| ('\u{AC00}'..='\u{D7A3}').contains(&ch));
    if locale_is_english(locale) {
        !has_hangul
    } else {
        has_hangul
    }
}

fn rate(count: usize, checked: usize) -> Option<f64> {
    (checked > 0).then(|| count as f64 / checked as f64)
}

fn median(values: &[usize]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    Some(if sorted.len() % 2 == 1 {
        sorted[mid] as f64
    } else {
        (sorted[mid - 1] + sorted[mid]) as f64 / 2.0
    })
}

fn count_true<'a>(values: impl Iterator<Item = &'a Option<bool>>) -> (usize, usize) {
    values.fold((0, 0), |(yes, checked), value| match value {
        Some(true) => (yes + 1, checked + 1),
        Some(false) => (yes, checked + 1),
        None => (yes, checked),
    })
}

fn tally(
    outcomes: &mut OutcomeCounts,
    drop_reasons: &mut BTreeMap<String, usize>,
    outcome: SupervisorValidationOutcome,
    drop_reason: Option<SupervisorDropReason>,
) {
    match outcome {
        SupervisorValidationOutcome::Shown => outcomes.shown += 1,
        SupervisorValidationOutcome::NoCard => outcomes.none += 1,
        SupervisorValidationOutcome::Dropped => outcomes.dropped += 1,
        SupervisorValidationOutcome::Error => outcomes.error += 1,
    }
    if let Some(reason) = drop_reason {
        *drop_reasons.entry(reason.as_str().to_string()).or_insert(0) += 1;
    }
}

/// Aggregates of one (promptVersion, policyVersion, model, split) group.
/// Each result is one trial scored on its final call — what the student would
/// see after the production retry loop; `attempts` counts every call of every
/// trial.
pub(crate) fn aggregate(key: super::report::GroupKey, results: Vec<EvalResult>) -> ReportGroup {
    let mut outcomes = OutcomeCounts::default();
    let mut drop_reasons = BTreeMap::new();
    let mut attempts = AttemptStats::default();
    for result in &results {
        tally(
            &mut outcomes,
            &mut drop_reasons,
            result.outcome,
            result.drop_reason,
        );
        attempts.calls += result.calls.len();
        attempts.retries += result.calls.len().saturating_sub(1);
        for call in &result.calls {
            tally(
                &mut attempts.outcomes,
                &mut attempts.drop_reasons,
                call.outcome,
                call.drop_reason,
            );
        }
    }

    let (agree, agreement_checked) =
        count_true(results.iter().map(|r| &r.checks.provoke_agreement));
    let false_provoke = results
        .iter()
        .filter(|r| r.checks.provoke_agreement == Some(false) && !r.expected.should_provoke)
        .count();
    let missed_provoke = results
        .iter()
        .filter(|r| r.checks.provoke_agreement == Some(false) && r.expected.should_provoke)
        .count();
    let (matched, match_checked) = count_true(results.iter().map(|r| &r.checks.drop_reason_match));
    let (compliant, locale_checked) =
        count_true(results.iter().map(|r| &r.checks.locale_compliant));
    let (linked, linkage_checked) = count_true(results.iter().map(|r| &r.checks.criterion_linked));
    let (required_cited, required_checked) =
        count_true(results.iter().map(|r| &r.checks.required_evidence_cited));
    let precisions = results
        .iter()
        .filter_map(|r| r.checks.evidence_precision)
        .collect::<Vec<_>>();
    let lengths = results
        .iter()
        .filter_map(|r| r.checks.question_chars)
        .collect::<Vec<_>>();

    ReportGroup {
        key,
        result_count: results.len(),
        outcomes,
        drop_reasons,
        provoke_agreement: ProvokeAgreement {
            checked: agreement_checked,
            agree,
            false_provoke,
            missed_provoke,
            rate: rate(agree, agreement_checked),
        },
        drop_reason_match: DropReasonMatch {
            checked: match_checked,
            matched,
            rate: rate(matched, match_checked),
        },
        locale_compliance: LocaleCompliance {
            checked: locale_checked,
            compliant,
            rate: rate(compliant, locale_checked),
        },
        criterion_linkage: CriterionLinkage {
            checked: linkage_checked,
            linked,
            rate: rate(linked, linkage_checked),
        },
        evidence_precision: EvidencePrecision {
            checked: precisions.len(),
            mean: (!precisions.is_empty())
                .then(|| precisions.iter().sum::<f64>() / precisions.len() as f64),
            required_cited,
            required_checked,
        },
        question_length: QuestionLength {
            count: lengths.len(),
            min: lengths.iter().min().copied(),
            median: median(&lengths),
            max: lengths.iter().max().copied(),
            mean: (!lengths.is_empty())
                .then(|| lengths.iter().sum::<usize>() as f64 / lengths.len() as f64),
            over_limit: lengths
                .iter()
                .filter(|len| **len > QUESTION_MAX_CHARS)
                .count(),
        },
        attempts,
        results,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_compliance_uses_hangul_presence() {
        assert!(locale_compliant("ko-KR", "테스트를 실행해 볼까요?"));
        assert!(!locale_compliant("ko-KR", "Can you run the tests?"));
        assert!(locale_compliant("en-US", "Can you run the tests?"));
        assert!(!locale_compliant("en-US", "Excel 내보내기가 필요한가요?"));
    }

    #[test]
    fn median_handles_odd_even_and_empty() {
        assert_eq!(median(&[]), None);
        assert_eq!(median(&[5, 1, 3]), Some(3.0));
        assert_eq!(median(&[4, 1, 3, 2]), Some(2.5));
    }
}
