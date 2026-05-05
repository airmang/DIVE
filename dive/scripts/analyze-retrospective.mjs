#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const POSITIVE = ["이해", "성공", "쉽", "도움", "검증", "완성", "명확", "좋"];
const NEGATIVE = ["어렵", "헷갈", "실패", "오류", "막힘", "불안", "느림", "복잡"];

function usage() {
  console.error(
    [
      "Usage: node scripts/analyze-retrospective.mjs <export.jsonl...> [--markdown <out.md>] [--json <out.json>]",
      "",
      "Reads DIVE JSONL exports and summarizes Card.retrospective records or",
      "default-safe Card.retrospective_metrics without attempting to de-anonymize students or sessions.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const files = [];
  let markdown = null;
  let json = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--markdown") {
      markdown = argv[++i] ?? null;
    } else if (arg === "--json") {
      json = argv[++i] ?? null;
    } else {
      files.push(arg);
    }
  }
  return { files, markdown, json };
}

function readJsonl(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${err.message}`);
      }
    });
}

function textValue(value) {
  if (typeof value !== "string") return "";
  if (/^(h|p|id):/.test(value)) return "";
  return value.trim();
}

function metricsValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function metricNumber(metrics, key) {
  const value = metrics?.[key];
  return Number.isFinite(value) ? value : 0;
}

function metricSentiment(metrics) {
  const value = metrics?.sentiment_bucket;
  return value === "positive" || value === "negative" || value === "neutral" ? value : "neutral";
}

function tokenizeKoreanish(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !/^(그리고|하지만|해서|저는|오늘|이번)$/.test(token));
}

function sentiment(text) {
  const positives = POSITIVE.filter((word) => text.includes(word)).length;
  const negatives = NEGATIVE.filter((word) => text.includes(word)).length;
  if (positives > negatives) return "positive";
  if (negatives > positives) return "negative";
  return "neutral";
}

function summarize(files) {
  const sessions = [];
  const cards = [];
  const keywordCounts = new Map();
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

  for (const file of files) {
    const records = readJsonl(file);
    const session = records.find((record) => record.kind === "session_meta");
    const sessionId = session?.session_id ?? path.basename(file);
    let retrospectiveCount = 0;
    let verifiedCards = 0;
    let totalCards = 0;

    for (const record of records) {
      if (record.kind !== "card") continue;
      totalCards += 1;
      if (record.state === "verified" || record.state === "extended") verifiedCards += 1;
      const retrospective = textValue(record.retrospective);
      const metrics = metricsValue(record.retrospective_metrics);
      if (!retrospective && !metrics) continue;
      retrospectiveCount += 1;
      const tone = retrospective ? sentiment(retrospective) : metricSentiment(metrics);
      sentimentCounts[tone] += 1;
      if (retrospective) {
        for (const token of tokenizeKoreanish(retrospective)) {
          keywordCounts.set(token, (keywordCounts.get(token) ?? 0) + 1);
        }
      }
      cards.push({
        source: file,
        sessionId,
        cardId: record.id ?? null,
        state: record.state,
        sentiment: tone,
        retrospectiveLength: retrospective
          ? retrospective.length
          : metricNumber(metrics, "char_count"),
        retrospectiveSource: retrospective ? "raw_text" : "derived_metrics",
      });
    }
    sessions.push({ source: file, sessionId, totalCards, verifiedCards, retrospectiveCount });
  }

  const topKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([keyword, count]) => ({ keyword, count }));

  return {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    sessions,
    cards,
    totals: {
      cards: cards.length,
      retrospectives: cards.length,
      sentiment: sentimentCounts,
    },
    topKeywords,
  };
}

function toMarkdown(summary) {
  const lines = [
    "# DIVE retrospective analysis",
    "",
    `- Generated at: ${summary.generatedAt}`,
    `- Files: ${summary.fileCount}`,
    `- Retrospectives: ${summary.totals.retrospectives}`,
    "",
    "## Sessions",
    "",
    "| Source | Session | Cards | Verified/Extended | Retrospectives |",
    "|---|---:|---:|---:|---:|",
    ...summary.sessions.map(
      (session) =>
        `| ${session.source} | ${session.sessionId} | ${session.totalCards} | ${session.verifiedCards} | ${session.retrospectiveCount} |`,
    ),
    "",
    "## Sentiment proxy",
    "",
    "| Positive | Neutral | Negative |",
    "|---:|---:|---:|",
    `| ${summary.totals.sentiment.positive} | ${summary.totals.sentiment.neutral} | ${summary.totals.sentiment.negative} |`,
    "",
    "## Top keywords",
    "",
    "| Keyword | Count |",
    "|---|---:|",
    ...summary.topKeywords.map((item) => `| ${item.keyword} | ${item.count} |`),
    "",
  ];
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.files.length === 0) {
  usage();
  process.exit(1);
}

const summary = summarize(args.files);
if (args.json) fs.writeFileSync(args.json, `${JSON.stringify(summary, null, 2)}\n`);
if (args.markdown) fs.writeFileSync(args.markdown, toMarkdown(summary));
if (!args.json && !args.markdown) {
  console.log(toMarkdown(summary));
}
