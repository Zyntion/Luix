import * as vscode from "vscode";
import { buildFontFaceReplacement } from "./data";
import {
  AutoImportAlias,
  AutoImportConfig,
  getAutoImportConfig,
} from "./config";
import { DIAGNOSTIC_CODE } from "./diagnostics";
import { WorkspaceIndex } from "./workspaceIndex";

// ============================================================================
// Auto-import code action (opt-in)
// ============================================================================

export class AutoImportCodeActionProvider
  implements vscode.CodeActionProvider
{
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  constructor(private readonly workspaceIndex: WorkspaceIndex) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const config = getAutoImportConfig();
    if (!config.enabled) {
      return actions;
    }

    for (const diag of context.diagnostics) {
      if (diag.code !== DIAGNOSTIC_CODE.MissingImport) {
        continue;
      }
      const componentName = document.getText(diag.range);
      const found = await this.workspaceIndex.findComponentFile(
        componentName,
        document.uri.toString()
      );
      if (!found) {
        continue;
      }
      const importPath = buildImportPath(
        document.uri,
        found.uri,
        config
      );
      if (!importPath) {
        continue;
      }
      const insertLine = findImportInsertionLine(document.getText());
      const insertPosition = new vscode.Position(insertLine, 0);
      const importLine = `local ${componentName} = require(${importPath})\n`;

      const action = new vscode.CodeAction(
        `Import ${componentName} from ${importPath}`,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      action.edit.insert(document.uri, insertPosition, importLine);
      actions.push(action);
    }

    return actions;
  }
}

export function buildImportPath(
  currentFileUri: vscode.Uri,
  componentFileUri: vscode.Uri,
  config: AutoImportConfig
): string | undefined {
  if (config.style === "alias") {
    const aliasPath = resolveViaAlias(componentFileUri, config.aliases);
    if (aliasPath) {
      return aliasPath;
    }
  }
  return buildRelativePath(currentFileUri, componentFileUri);
}

export function buildRelativePath(
  fromUri: vscode.Uri,
  toUri: vscode.Uri
): string {
  const path = require("path") as typeof import("path");
  const rel = path.relative(
    path.dirname(fromUri.fsPath),
    toUri.fsPath
  );
  const parts = rel.split(path.sep);
  let result = "script.Parent";
  for (const part of parts) {
    if (part === "..") {
      result += ".Parent";
    } else if (part !== "" && part !== ".") {
      const clean = part.replace(/\.lua[u]?$/, "");
      result += `.${clean}`;
    }
  }
  return result;
}

export function resolveViaAlias(
  componentUri: vscode.Uri,
  aliases: AutoImportAlias[]
): string | undefined {
  if (aliases.length === 0) {
    return undefined;
  }
  const path = require("path") as typeof import("path");
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(componentUri);
  if (!workspaceFolder) {
    return undefined;
  }
  const relFromWorkspace = path.relative(
    workspaceFolder.uri.fsPath,
    componentUri.fsPath
  );
  for (const alias of aliases) {
    const normalized = alias.filesystemPath.replace(/\/+$/, "");
    if (
      relFromWorkspace === normalized ||
      relFromWorkspace.startsWith(normalized + path.sep)
    ) {
      const remaining = relFromWorkspace
        .slice(normalized.length)
        .replace(/^[/\\]+/, "");
      const segments = remaining
        .split(path.sep)
        .filter((s) => s.length > 0)
        .map((s) => s.replace(/\.lua[u]?$/, ""));
      if (segments.length === 0) {
        return alias.robloxPath;
      }
      return `${alias.robloxPath}.${segments.join(".")}`;
    }
  }
  return undefined;
}

function findImportInsertionLine(text: string): number {
  const lines = text.split("\n");
  let lastRequireLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*local\s+[A-Za-z_]\w*\s*=\s*require\b/.test(lines[i])) {
      lastRequireLine = i;
    }
  }
  if (lastRequireLine !== -1) {
    return lastRequireLine + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith("--")) {
      continue;
    }
    return i;
  }
  return 0;
}

// ============================================================================
// Deprecation quick fixes — Font → FontFace, TextColor → TextColor3
// ============================================================================

export class DeprecationCodeActionProvider
  implements vscode.CodeActionProvider
{
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.code === DIAGNOSTIC_CODE.DeprecatedFont) {
        actions.push(this.fontFix(document, diag));
      } else if (diag.code === DIAGNOSTIC_CODE.TypoTextColor) {
        actions.push(this.textColorFix(document, diag));
      }
    }

    return actions;
  }

  private fontFix(
    document: vscode.TextDocument,
    diag: vscode.Diagnostic
  ): vscode.CodeAction {
    const original = document.getText(diag.range);
    const m = /Font\s*=\s*Enum\.Font\.([A-Za-z_]\w*)/.exec(original);
    const enumName = m ? m[1] : "SourceSans";
    const replacement = `FontFace = ${buildFontFaceReplacement(enumName)}`;

    const action = new vscode.CodeAction(
      `Replace with \`FontFace = Font.fromName(...)\``,
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diag];
    action.isPreferred = true;
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, diag.range, replacement);
    return action;
  }

  private textColorFix(
    document: vscode.TextDocument,
    diag: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      "Rename to `TextColor3`",
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diag];
    action.isPreferred = true;
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, diag.range, "TextColor3");
    return action;
  }
}
