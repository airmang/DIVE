import { computeLineDiff } from "./diff";
import type { DiffPreviewData, PermissionChangeSummary } from "./types";

export type SummaryTranslator = (key: string, params?: Record<string, string | number>) => string;

interface SummaryInput {
  toolName: string;
  diff: DiffPreviewData | null;
  args: unknown;
  t: SummaryTranslator;
}

type ArgsObject = Record<string, unknown>;

function asObject(args: unknown): ArgsObject {
  return args !== null && typeof args === "object" ? (args as ArgsObject) : {};
}

function stringValue(args: ArgsObject, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function extension(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const last = clean.split("/").pop() ?? clean;
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
}

function fileKind(path: string, t: SummaryTranslator): string {
  switch (extension(path)) {
    case "html":
    case "htm":
      return t("permission_card.change_summary.file_kind.html");
    case "css":
      return t("permission_card.change_summary.file_kind.css");
    case "tsx":
    case "jsx":
      return t("permission_card.change_summary.file_kind.component");
    case "ts":
    case "js":
      return t("permission_card.change_summary.file_kind.code");
    case "json":
      return t("permission_card.change_summary.file_kind.json");
    case "md":
    case "mdx":
      return t("permission_card.change_summary.file_kind.markdown");
    default:
      return t("permission_card.change_summary.file_kind.file");
  }
}

function addedText(diff: DiffPreviewData): string {
  return computeLineDiff(diff.before, diff.after)
    .lines.filter((line) => line.op === "add")
    .map((line) => line.text)
    .join("\n");
}

function countTableRows(text: string): number {
  const trRows = text.match(/<tr\b/gi)?.length ?? 0;
  if (trRows > 0) return trRows;
  const tableBody = text.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  if (!tableBody) return 0;
  return tableBody.split(/\r?\n/).filter((line) => /<t[dh]\b/i.test(line)).length;
}

function dependencyNamesFromPackageJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ].sort();
  } catch {
    return [];
  }
}

function compactList(items: string[], max = 3): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max}`;
}

function structuralDetails(
  diff: DiffPreviewData,
  args: ArgsObject,
  t: SummaryTranslator,
): string[] {
  const added = addedText(diff);
  const details: string[] = [];
  const tableRows = countTableRows(added);
  if (tableRows > 0) {
    details.push(t("permission_card.change_summary.hints.table", { count: tableRows }));
  }
  if (/<form\b/i.test(added)) {
    details.push(t("permission_card.change_summary.hints.form"));
  }
  if (/:hover\b/i.test(added)) {
    details.push(t("permission_card.change_summary.hints.hover"));
  }
  if (/\b(addEventListener|onClick|onclick)\b/.test(added)) {
    details.push(t("permission_card.change_summary.hints.interaction"));
  }
  if (/package\.json$/.test(diff.path)) {
    const packageNames = dependencyNamesFromPackageJson(stringValue(args, "content") ?? diff.after);
    if (packageNames.length > 0) {
      details.push(
        t("permission_card.change_summary.hints.dependencies", {
          packages: compactList(packageNames),
        }),
      );
    }
  }
  return details;
}

export function summarizePatch({
  toolName,
  diff,
  args,
  t,
}: SummaryInput): PermissionChangeSummary | null {
  if (!diff) return null;

  const result = computeLineDiff(diff.before, diff.after);
  const argsObject = asObject(args);
  const kind = fileKind(diff.path, t);
  const beforeLines = lineCount(diff.before);
  const afterLines = lineCount(diff.after);
  const wholeFileReplacement = toolName === "write_file" && beforeLines > 0;

  const headline = wholeFileReplacement
    ? t("permission_card.change_summary.replace_file", {
        fileKind: kind,
        removed: beforeLines,
        added: afterLines,
      })
    : beforeLines === 0
      ? t("permission_card.change_summary.create_file", {
          fileKind: kind,
          added: afterLines,
        })
      : t("permission_card.change_summary.edit_file", {
          fileKind: kind,
          added: result.addCount,
          removed: result.delCount,
        });

  const details = structuralDetails(diff, argsObject, t);
  if (details.length === 0) {
    details.push(
      t("permission_card.change_summary.line_counts", {
        added: result.addCount,
        removed: result.delCount,
      }),
    );
  }

  return {
    headline,
    details,
    addedLines: result.addCount,
    removedLines: result.delCount,
    fileKind: kind,
    wholeFileReplacement,
  };
}
