import type { RiskLevel } from "./types";

type ArgsObject = Record<string, unknown>;

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

function riskCopy(risk: RiskLevel): Pick<ToolExplanation, "riskLabel" | "riskBody"> {
  switch (risk) {
    case "safe":
      return {
        riskLabel: "Safe read",
        riskBody:
          "This only reads project information. It should not change files or run commands.",
      };
    case "warn":
      return {
        riskLabel: "Needs your approval",
        riskBody: "This may change files. Review the file path and preview before allowing it.",
      };
    case "danger":
      return {
        riskLabel: "Higher risk",
        riskBody:
          "This can run commands or remove files. DIVE will not continue unless you explicitly allow it.",
      };
  }
}

export function explainTool(toolName: string, risk: RiskLevel, args: unknown): ToolExplanation {
  const objectArgs = asObject(args);
  const baseRisk = riskCopy(risk);
  const command = commandText(toolName, objectArgs);

  switch (toolName) {
    case "read_file":
      return {
        ...baseRisk,
        actionTitle: "Read a file",
        actionBody: "DIVE wants to open this file so it can understand the project before acting.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: ["Allow the read", "Deny if this file should stay private"],
        patchPreviewExpected: false,
      };
    case "list_dir":
      return {
        ...baseRisk,
        actionTitle: "List files in a folder",
        actionBody: "DIVE wants to see the folder names so it can choose the right next step.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: ["Allow the read", "Deny if this folder should stay private"],
        patchPreviewExpected: false,
      };
    case "search_files":
      return {
        ...baseRisk,
        actionTitle: "Search project files",
        actionBody: "DIVE wants to search text in your project. This should not edit anything.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "no",
        choices: ["Allow the search", "Deny if the search is unnecessary"],
        patchPreviewExpected: false,
      };
    case "write_file":
      return {
        ...baseRisk,
        actionTitle: "Create or replace a file",
        actionBody:
          "DIVE wants to write new content to this file. Review the preview before allowing it.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: ["Allow the file change", "Edit the request", "Deny and ask DIVE to explain"],
        patchPreviewExpected: true,
      };
    case "edit_file":
      return {
        ...baseRisk,
        actionTitle: "Edit part of a file",
        actionBody:
          "DIVE wants to replace matching text in this file. Review the before/after preview.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: ["Allow the edit", "Edit the request", "Deny and ask for a safer change"],
        patchPreviewExpected: true,
      };
    case "delete_file":
      return {
        ...baseRisk,
        actionTitle: "Delete a file",
        actionBody:
          "DIVE wants to remove this file from the project. Only allow this if you expected it.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: ["Allow the delete", "Deny and keep the file"],
        patchPreviewExpected: false,
      };
    case "mkdir":
      return {
        ...baseRisk,
        actionTitle: "Create a folder",
        actionBody: "DIVE wants to add a folder inside the project.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: "yes",
        choices: ["Allow the folder", "Deny if the location looks wrong"],
        patchPreviewExpected: false,
      };
    case "run_process":
      return {
        ...baseRisk,
        actionTitle: "Run a project command",
        actionBody:
          "DIVE wants to run one program in the project folder. It may check, build, install, or generate files depending on the command.",
        files: [],
        command,
        commandWillChangeFiles: "maybe",
        choices: ["Allow the command", "Deny and ask what it is for", "Edit the command first"],
        patchPreviewExpected: false,
      };
    case "bash":
      return {
        ...baseRisk,
        actionTitle: "Run a shell command",
        actionBody:
          "DIVE wants to run this through the shell. Shell commands are powerful, so blocked patterns still cannot run even if approved.",
        files: [],
        command,
        commandWillChangeFiles: "maybe",
        choices: [
          "Allow the command",
          "Deny and ask for a safer command",
          "Edit the command first",
        ],
        patchPreviewExpected: false,
      };
    default:
      return {
        ...baseRisk,
        actionTitle: `Use ${toolName}`,
        actionBody: "DIVE wants to use this tool. Review the details before allowing it.",
        files: pathList(objectArgs),
        command,
        commandWillChangeFiles: risk === "safe" ? "no" : "maybe",
        choices: ["Allow", "Deny", "Edit the request if the details look wrong"],
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
