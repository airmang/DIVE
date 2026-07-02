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
  projectCommand?: {
    executable: string;
    args: string[];
    timeoutSec: number | null;
    reason: string | null;
    expectedEffect: string | null;
  };
  terminalScript?: {
    script: string;
    shellFamily: string;
    reason: string | null;
    expectedEffect: string | null;
    timeoutSec: number | null;
    outputLimit: number | null;
    riskFactors: string[];
  };
  webFetch?: {
    url: string;
    host: string;
    resolvedIp: string | null;
    port: number | null;
    purpose: string | null;
    queryDropped: boolean;
  };
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

function numberValue(args: ArgsObject, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pathList(args: ArgsObject): string[] {
  const path = stringValue(args, "path");
  return [...new Set([...(path ? [path] : []), ...stringArray(args, "paths")])];
}

function projectCommandDetails(args: ArgsObject): ToolExplanation["projectCommand"] {
  const executable = stringValue(args, "command");
  if (!executable) return undefined;
  return {
    executable,
    args: stringArray(args, "args"),
    timeoutSec: numberValue(args, "timeout_sec"),
    reason: stringValue(args, "reason"),
    expectedEffect: stringValue(args, "expected_effect"),
  };
}

function terminalScriptDetails(args: ArgsObject): ToolExplanation["terminalScript"] {
  const script = stringValue(args, "script");
  if (!script) return undefined;
  const suppliedRiskFactors = stringArray(args, "risk_factors");
  const riskFactors =
    suppliedRiskFactors.length > 0 ? suppliedRiskFactors : ["shell_script", "one_shot_high_risk"];
  return {
    script,
    shellFamily: stringValue(args, "shell_family") ?? "unknown",
    reason: stringValue(args, "reason"),
    expectedEffect: stringValue(args, "expected_effect"),
    timeoutSec: numberValue(args, "timeout_sec"),
    outputLimit: numberValue(args, "output_limit"),
    riskFactors,
  };
}

function objectValue(args: ArgsObject, key: string): ArgsObject | null {
  const value = args[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ArgsObject)
    : null;
}

function boolValue(args: ArgsObject, key: string): boolean {
  return args[key] === true;
}

function webFetchDetails(args: ArgsObject): ToolExplanation["webFetch"] {
  const url = stringValue(args, "url");
  if (!url) return undefined;
  const approval = objectValue(args, "web_fetch_approval");
  return {
    url,
    host: stringValue(approval ?? {}, "host") ?? url,
    resolvedIp: stringValue(approval ?? {}, "pinnedIp"),
    port: numberValue(approval ?? {}, "port"),
    purpose: stringValue(args, "purpose") ?? stringValue(approval ?? {}, "purpose"),
    queryDropped: boolValue(approval ?? {}, "queryDropped"),
  };
}

function commandText(toolName: string, args: ArgsObject): string | null {
  if (toolName === "bash") return stringValue(args, "cmd") ?? stringValue(args, "command");
  if (toolName === "run_terminal_script") return stringValue(args, "script");
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
    case "multi_replace":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.multi_replace.title"),
        actionBody: t("permission_card.explain.tools.multi_replace.body"),
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
        projectCommand: projectCommandDetails(objectArgs),
        commandWillChangeFiles: "maybe",
        choices: choices(t, ["allow_command", "deny_ask_purpose", "edit_command_first"]),
        patchPreviewExpected: false,
      };
    case "run_terminal_script":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.run_terminal_script.title"),
        actionBody: t("permission_card.explain.tools.run_terminal_script.body"),
        files: [],
        command,
        terminalScript: terminalScriptDetails(objectArgs),
        commandWillChangeFiles: "maybe",
        choices: choices(t, ["allow_command", "deny_ask_safer_command", "edit_command_first"]),
        patchPreviewExpected: false,
      };
    case "web_fetch":
      return {
        ...baseRisk,
        actionTitle: t("permission_card.explain.tools.web_fetch.title"),
        actionBody: t("permission_card.explain.tools.web_fetch.body"),
        files: [],
        command: null,
        webFetch: webFetchDetails(objectArgs),
        commandWillChangeFiles: "no",
        choices: choices(t, ["allow_web_read", "deny_ask_purpose"]),
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
