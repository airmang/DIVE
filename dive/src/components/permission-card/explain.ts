import type { RiskLevel } from "./types";

type ArgsObject = Record<string, unknown>;
export type PermissionCardTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export interface ToolExplanation {
  actionTitle: string;
  actionBody: string;
  files: string[];
  command: string | null;
  commandWillChangeFiles: "no" | "maybe" | "yes";
  riskLabel: string;
  riskBody: string;
  choices: string[];
  patchPreviewExpected: boolean;
}

function asObject(args: unknown): ArgsObject {
  return args !== null && typeof args === "object" ? (args as ArgsObject) : {};
}

function stringValue(args: ArgsObject, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(args: ArgsObject, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function pathList(args: ArgsObject): string[] {
  const path = stringValue(args, "path");
  return path ? [path] : [];
}

function commandText(toolName: string, args: ArgsObject): string | null {
  if (toolName === "bash") return stringValue(args, "cmd") ?? stringValue(args, "command");
  if (toolName !== "run_process") return null;
  const command = stringValue(args, "command");
  if (!command) return null;
  const argv = stringArray(args, "args");
  return argv.length > 0 ? [command, ...argv].join(" ") : command;
}

function riskCopy(
  risk: RiskLevel,
  t: PermissionCardTranslator,
): Pick<ToolExplanation, "riskLabel" | "riskBody"> {
  return {
    riskLabel: t(`permission_card.risk.${risk}.label`),
    riskBody: t(`permission_card.risk.${risk}.body`),
  };
}

function choices(t: PermissionCardTranslator, keys: string[]): string[] {
  return keys.map((key) => t(`permission_card.explain.choices.${key}`));
}

export function explainTool(
  toolName: string,
  risk: RiskLevel,
  args: unknown,
  t: PermissionCardTranslator,
): ToolExplanation {
  const objectArgs = asObject(args);
  const baseRisk = riskCopy(risk, t);
  const command = commandText(toolName, objectArgs);

  switch (toolName) {
    case "read_file":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.read_file.title"),
        actionBody: t("permission_card.explain.tools.read_file.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: choices(t, ["allow_read", "deny_file_private"]),
        patchPreviewExpected: false,
      };
    case "list_dir":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.list_dir.title"),
        actionBody: t("permission_card.explain.tools.list_dir.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: choices(t, ["allow_read", "deny_folder_private"]),
        patchPreviewExpected: false,
      };
    case "search_files":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.search_files.title"),
        actionBody: t("permission_card.explain.tools.search_files.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: choices(t, ["allow_search", "deny_unnecessary_search"]),
        patchPreviewExpected: false,
      };
    case "write_file":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.write_file.title"),
        actionBody: t("permission_card.explain.tools.write_file.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: choices(t, ["allow_file_change", "edit_request", "deny_ask_explain"]),
        patchPreviewExpected: true,
      };
    case "edit_file":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.edit_file.title"),
        actionBody: t("permission_card.explain.tools.edit_file.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: choices(t, ["allow_edit", "edit_request", "deny_ask_safer_change"]),
        patchPreviewExpected: true,
      };
    case "delete_file":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.delete_file.title"),
        actionBody: t("permission_card.explain.tools.delete_file.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: choices(t, ["allow_delete", "deny_keep_file"]),
        patchPreviewExpected: false,
      };
    case "mkdir":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.mkdir.title"),
        actionBody: t("permission_card.explain.tools.mkdir.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: choices(t, ["allow_folder", "deny_wrong_location"]),
        patchPreviewExpected: false,
      };
    case "run_process":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.run_process.title"),
        actionBody: t("permission_card.explain.tools.run_process.body"),
        files: [],
        command,
        commandWillChangeFiles: "maybe",
        choices: choices(t, ["allow_command", "deny_ask_purpose", "edit_command_first"]),
        patchPreviewExpected: false,
      };
    case "bash":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.bash.title"),
        actionBody: t("permission_card.explain.tools.bash.body"),
        files: [],
        command,
        commandWillChangeFiles: "maybe",
        choices: choices(t, ["allow_command", "deny_ask_safer_command", "edit_command_first"]),
        patchPreviewExpected: false,
      };
    default:
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.default.title", { toolName }),
        actionBody: t("permission_card.explain.tools.default.body"),
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: risk === "safe" ? "no" : "maybe",
        choices: choices(t, ["allow", "deny", "edit_if_wrong"]),
        patchPreviewExpected: false,
      };
  }
}

export function formatRaw(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
