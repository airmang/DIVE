#!/usr/bin/env node
// Usage: node scripts/analyze-supervision.mjs <export.jsonl>
// Aggregates automatic supervision metrics 1, 3, and 4 from DIVE JSONL export.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: analyze-supervision.mjs <export.jsonl>");
  process.exit(1);
}

const records = readFileSync(path, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const cards = records.filter((record) => record.kind === "card");
const events = records.filter((record) => record.kind === "event");

const aiClaimed = cards.filter((card) => card.verify_log && card.verify_log.intent_match === true);
const dissent = aiClaimed.filter(
  (card) =>
    card.approval_judgment &&
    ["approved_with_concern", "revision_requested"].includes(card.approval_judgment.outcome),
);
const dissentRate = aiClaimed.length ? dissent.length / aiClaimed.length : null;

const skippedApproved = cards.filter(
  (card) =>
    card.verify_log &&
    card.verify_log.test_result === "skipped" &&
    card.approval_judgment &&
    ["approved", "approved_with_concern"].includes(card.approval_judgment.outcome),
);
const overTrust = skippedApproved.filter(
  (card) => card.approval_judgment.outcome === "approved",
);
const overTrustRate = skippedApproved.length ? overTrust.length / skippedApproved.length : null;

const steerEvents = events.filter((event) =>
  ["plan_critique", "plan_revision_requested", "plan_step_appended"].includes(event.type),
);
const steerCount = steerEvents.length;

const report = {
  cards_total: cards.length,
  metric_1_dissent_rate: dissentRate,
  metric_1_basis: { ai_claimed_met: aiClaimed.length, dissented: dissent.length },
  metric_4_over_trust_rate: overTrustRate,
  metric_4_basis: {
    skipped_approved: skippedApproved.length,
    approved_no_concern: overTrust.length,
  },
  metric_3_steer_events: steerCount,
  metric_3_note: events.length ? "from event records" : "no event records in export - see research-measures steer",
};

console.log(JSON.stringify(report, null, 2));
