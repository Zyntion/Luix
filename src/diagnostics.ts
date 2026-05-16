import * as vscode from "vscode";
import { defaultPropsMap, flattenClassProps } from "./data";
import {
  AliasPartition,
  applyMask,
  buildCodeMask,
  findAllCreateElementCalls,
  findEnclosingPropsCall,
  scanDocument,
  collectLocalBindings,
} from "./parser";
import { getAutoImportConfig } from "./config";
import { configChangeAffects, getConfig } from "./configCompat";
import { getAliasPartition } from "./frameworks";
import { WorkspaceIndex } from "./workspaceIndex";

export const DIAGNOSTIC_CODE = {
  ReservedName: "rlph.reserved-name",
  DeprecatedFont: "rlph.deprecated-font",
  TypoTextColor: "rlph.typo-textcolor",
  MissingImport: "rlph.missing-import",
} as const;

export class DiagnosticsManager implements vscode.Disposable {
  private collection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly workspaceIndex: WorkspaceIndex) {
    this.collection = vscode.languages.createDiagnosticCollection(
      "react-luau-props-helper"
    );
    this.disposables.push(this.collection);
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => {
        void this.maybeRefresh(d);
      }),
      vscode.workspace.onDidChangeTextDocument((e) =>
        this.scheduleRefresh(e.document)
      ),
      vscode.workspace.onDidCloseTextDocument((d) =>
        this.collection.delete(d.uri)
      ),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          configChangeAffects(e, "warnReservedPropNames") ||
          configChangeAffects(e, "deprecationDiagnostics") ||
          configChangeAffects(e, "autoImport")
        ) {
          this.refreshAllOpenDocuments();
        }
      })
    );

    this.refreshAllOpenDocuments();
  }

  private refreshAllOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      void this.maybeRefresh(doc);
    }
  }

  private scheduleRefresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.maybeRefresh(document);
    }, 200);
    this.debounceTimers.set(key, t);
  }

  private async maybeRefresh(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== "lua" && document.languageId !== "luau") {
      return;
    }
    const diags = await this.computeDiagnostics(document);
    this.collection.set(document.uri, diags);
  }

  private async computeDiagnostics(
    document: vscode.TextDocument
  ): Promise<vscode.Diagnostic[]> {
    const warnReserved = getConfig<boolean>(
      "warnReservedPropNames",
      false
    );
    const warnDeprecation = getConfig<boolean>(
      "deprecationDiagnostics",
      true
    );
    const autoImport = getAutoImportConfig();

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];

    if (warnReserved) {
      diagnostics.push(...computeReservedNameDiagnostics(text));
    }
    if (warnDeprecation) {
      diagnostics.push(...computeDeprecationDiagnostics(text, document));
    }
    if (autoImport.enabled) {
      diagnostics.push(
        ...(await computeMissingImportDiagnostics(
          text,
          document,
          this.workspaceIndex
        ))
      );
    }

    return diagnostics;
  }

  dispose(): void {
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

async function computeMissingImportDiagnostics(
  text: string,
  document: vscode.TextDocument,
  workspaceIndex: WorkspaceIndex
): Promise<vscode.Diagnostic[]> {
  const out: vscode.Diagnostic[] = [];
  const aliases = getAliasPartition();
  const calls = findAllCreateElementCalls(text, aliases);

  const localBindings = collectLocalBindings(text);
  const reported = new Set<string>();

  for (const call of calls) {
    if (call.isStringLiteralName) {
      continue;
    }
    const name = call.className.split(".")[0];
    if (defaultPropsMap[name]) {
      continue;
    }
    if (localBindings.has(name)) {
      continue;
    }
    if (reported.has(name)) {
      continue;
    }

    const found = await workspaceIndex.findComponentFile(
      call.className,
      document.uri.toString()
    );
    if (!found) {
      continue;
    }

    reported.add(name);
    const range = new vscode.Range(
      document.positionAt(call.classNameStart),
      document.positionAt(call.classNameEnd)
    );
    const d = new vscode.Diagnostic(
      range,
      `\`${call.className}\` isn't imported in this file.`,
      vscode.DiagnosticSeverity.Information
    );
    d.code = DIAGNOSTIC_CODE.MissingImport;
    d.source = "react-luau-props-helper";
    out.push(d);
  }

  return out;
}

function computeReservedNameDiagnostics(text: string): vscode.Diagnostic[] {
  const out: vscode.Diagnostic[] = [];
  const scan = scanDocument(text, getAliasPartition());

  for (const info of scan.values()) {
    const base = info.annotations.extendsClass ?? info.detectedBase;
    if (!base) {
      continue;
    }
    const baseProps = new Set(flattenClassProps(base));
    if (baseProps.size === 0) {
      continue;
    }

    const annotatedNames = new Set(info.annotations.props);
    if (annotatedNames.size === 0) {
      continue;
    }

    const lines = text.split("\n");
    for (let i = info.defLineIndex - 1; i >= 0; i--) {
      const line = lines[i];
      const m = /^(\s*)---\s*@prop\s+([A-Za-z_]\w*)/.exec(line);
      if (!m) {
        if (line.trimStart().startsWith("---")) {
          continue;
        }
        break;
      }
      const propName = m[2];
      if (!annotatedNames.has(propName) || !baseProps.has(propName)) {
        continue;
      }
      const start = line.indexOf(propName, m[1].length);
      const range = new vscode.Range(
        new vscode.Position(i, start),
        new vscode.Position(i, start + propName.length)
      );
      const d = new vscode.Diagnostic(
        range,
        `Prop \`${propName}\` shadows \`${base}.${propName}\` — when forwarded to the instance it'll set the property instead of staying as a component prop.`,
        vscode.DiagnosticSeverity.Warning
      );
      d.code = DIAGNOSTIC_CODE.ReservedName;
      d.source = "react-luau-props-helper";
      out.push(d);
    }
  }

  return out;
}

function computeDeprecationDiagnostics(
  text: string,
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const out: vscode.Diagnostic[] = [];
  const masked = applyMask(text, buildCodeMask(text));
  const aliases = getAliasPartition();

  // `Font = Enum.Font.X` inside a createElement props table.
  const fontRe = /\bFont\s*=\s*Enum\.Font\.([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = fontRe.exec(masked)) !== null) {
    if (!isOffsetInsideAnyPropsTable(text, m.index, aliases)) {
      continue;
    }
    const range = new vscode.Range(
      document.positionAt(m.index),
      document.positionAt(m.index + m[0].length)
    );
    const d = new vscode.Diagnostic(
      range,
      "`Font` is deprecated; prefer `FontFace` with `Font.fromName(...)`.",
      vscode.DiagnosticSeverity.Information
    );
    d.code = DIAGNOSTIC_CODE.DeprecatedFont;
    d.source = "react-luau-props-helper";
    d.tags = [vscode.DiagnosticTag.Deprecated];
    out.push(d);
  }

  // `TextColor = ...` (missing the trailing `3`) inside a props table.
  const typoRe = /(?<![A-Za-z0-9_])TextColor(?!\d)\s*=/g;
  let t: RegExpExecArray | null;
  while ((t = typoRe.exec(masked)) !== null) {
    if (!isOffsetInsideAnyPropsTable(text, t.index, aliases)) {
      continue;
    }
    const propStart = t.index;
    const propEnd = propStart + "TextColor".length;
    const range = new vscode.Range(
      document.positionAt(propStart),
      document.positionAt(propEnd)
    );
    const d = new vscode.Diagnostic(
      range,
      "`TextColor` is not a Roblox property — did you mean `TextColor3`?",
      vscode.DiagnosticSeverity.Warning
    );
    d.code = DIAGNOSTIC_CODE.TypoTextColor;
    d.source = "react-luau-props-helper";
    out.push(d);
  }

  return out;
}

function isOffsetInsideAnyPropsTable(
  text: string,
  offset: number,
  aliases: AliasPartition
): boolean {
  return findEnclosingPropsCall(text, offset, aliases) !== undefined;
}
