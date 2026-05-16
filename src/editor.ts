import * as vscode from "vscode";
import {
  PROP_TYPES,
  findIntroducingClass,
  flattenClassProps,
} from "./data";
import {
  CallTreeNode,
  applyMask,
  buildCallTree,
  buildCodeMask,
  extractColorLiterals,
  findAllCreateElementCalls,
  findEnclosingPropsCall,
} from "./parser";
import { getAliasPartition } from "./frameworks";
import { configChangeAffects, getConfig } from "./configCompat";

// ============================================================================
// Color preview — DocumentColorProvider
// ============================================================================

export class Color3DocumentColorProvider
  implements vscode.DocumentColorProvider
{
  provideDocumentColors(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.ColorInformation[]> {
    if (!getConfig<boolean>("colorPreview.enabled", true)) {
      return [];
    }
    const text = document.getText();
    // Both calls hit the same cache entry — `applyMask` recognises the
    // mask returned by `buildCodeMask` and returns the cached masked text.
    const masked = applyMask(text, buildCodeMask(text));
    return extractColorLiterals(masked).map((c) => {
      const range = new vscode.Range(
        document.positionAt(c.start),
        document.positionAt(c.end)
      );
      return new vscode.ColorInformation(
        range,
        new vscode.Color(c.r, c.g, c.b, 1)
      );
    });
  }

  provideColorPresentations(
    color: vscode.Color,
    _context: { document: vscode.TextDocument; range: vscode.Range }
  ): vscode.ProviderResult<vscode.ColorPresentation[]> {
    const r255 = Math.round(color.red * 255);
    const g255 = Math.round(color.green * 255);
    const b255 = Math.round(color.blue * 255);
    const rgb = new vscode.ColorPresentation(
      `Color3.fromRGB(${r255}, ${g255}, ${b255})`
    );
    const fmt = (n: number) =>
      Number.isInteger(n) ? n.toString() : n.toFixed(3);
    const newForm = new vscode.ColorPresentation(
      `Color3.new(${fmt(color.red)}, ${fmt(color.green)}, ${fmt(color.blue)})`
    );
    return [rgb, newForm];
  }
}

// ============================================================================
// Hover — type/class/docs tooltips for props inside e(...) tables
// ============================================================================

export class PropHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const cursorOffset = document.offsetAt(position);
    const detected = findEnclosingPropsCall(text, cursorOffset, getAliasPartition());
    if (!detected) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );
    if (!wordRange) {
      return undefined;
    }
    const word = document.getText(wordRange);

    const props = flattenClassProps(detected.className);
    if (!props.includes(word)) {
      return undefined;
    }

    const md = buildPropHoverMarkdown(detected.className, word);
    return new vscode.Hover(md, wordRange);
  }
}

function buildPropHoverMarkdown(
  className: string,
  propName: string
): vscode.MarkdownString {
  const type = PROP_TYPES[propName];
  const introduced = findIntroducingClass(className, propName);
  const docsAnchor = introduced ?? className;
  const docsUrl = `https://create.roblox.com/docs/reference/engine/classes/${docsAnchor}#${propName}`;

  const lines: string[] = [];
  lines.push(`**${className}.${propName}**`);
  lines.push("");
  if (type) {
    lines.push(`Type: \`${type}\``);
  }
  if (introduced && introduced !== className) {
    lines.push(`Inherited from \`${introduced}\`.`);
  }
  lines.push("");
  lines.push(`[Roblox docs ↗](${docsUrl})`);

  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;
  return md;
}

// ============================================================================
// Inlay hints — `}) ▸ Frame (Container)` at every multi-line createElement
// ============================================================================

export class CreateElementInlayHintsProvider
  implements vscode.InlayHintsProvider, vscode.Disposable
{
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints: vscode.Event<void> =
    this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        const scope = getConfig<string>(
          "inlayHints.scope",
          "ancestors"
        );
        if (scope !== "all") {
          this._onDidChange.fire();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (configChangeAffects(e, "inlayHints")) {
          this._onDidChange.fire();
        }
      })
    );
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    if (!getConfig<boolean>("inlayHints.enabled", true)) {
      return [];
    }
    const scope = getConfig<string>("inlayHints.scope", "ancestors");
    const position = getConfig<string>(
      "inlayHints.position",
      "after-comma"
    );

    const text = document.getText();
    const calls = findAllCreateElementCalls(text, getAliasPartition());
    const hints: vscode.InlayHint[] = [];

    let cursorOffset: number | undefined;
    if (scope === "ancestors") {
      const editor = vscode.window.activeTextEditor;
      if (
        editor &&
        editor.document.uri.toString() === document.uri.toString()
      ) {
        cursorOffset = document.offsetAt(editor.selection.active);
      }
    }

    for (const call of calls) {
      const openPos = document.positionAt(call.aliasStart);
      const closePos = document.positionAt(call.fullEnd);
      if (openPos.line === closePos.line) {
        continue;
      }
      if (closePos.line < range.start.line || openPos.line > range.end.line) {
        continue;
      }

      if (scope === "ancestors") {
        if (cursorOffset === undefined) {
          continue;
        }
        if (cursorOffset < call.aliasStart || cursorOffset > call.fullEnd) {
          continue;
        }
      }

      let hintOffset = call.fullEnd;
      if (position === "after-comma" && text[call.fullEnd] === ",") {
        hintOffset = call.fullEnd + 1;
      }
      const hintPos = document.positionAt(hintOffset);

      const label = call.nameProp
        ? `▸ ${call.className} (${call.nameProp})`
        : `▸ ${call.className}`;

      const hint = new vscode.InlayHint(
        hintPos,
        ` ${label}`,
        vscode.InlayHintKind.Type
      );
      hint.paddingLeft = true;
      hints.push(hint);
    }

    return hints;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this._onDidChange.dispose();
  }
}

// ============================================================================
// Document symbols — Outline + breadcrumbs view of the React tree
// ============================================================================

export class CreateElementSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  provideDocumentSymbols(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (!getConfig<boolean>("documentSymbols.enabled", true)) {
      return [];
    }
    const text = document.getText();
    const calls = findAllCreateElementCalls(text, getAliasPartition());
    const tree = buildCallTree(calls);
    return tree.map((node) => this.nodeToSymbol(document, node));
  }

  private nodeToSymbol(
    document: vscode.TextDocument,
    node: CallTreeNode
  ): vscode.DocumentSymbol {
    const call = node.call;
    const fullRange = new vscode.Range(
      document.positionAt(call.aliasStart),
      document.positionAt(call.fullEnd)
    );
    const selectionRange = new vscode.Range(
      document.positionAt(call.classNameStart),
      document.positionAt(call.classNameEnd)
    );

    const name = call.nameProp
      ? `${call.className} (${call.nameProp})`
      : call.className;

    const kind = call.isStringLiteralName
      ? vscode.SymbolKind.Object
      : vscode.SymbolKind.Function;

    const symbol = new vscode.DocumentSymbol(
      name,
      call.isStringLiteralName ? "" : "(component)",
      kind,
      fullRange,
      selectionRange
    );

    symbol.children = node.children.map((child) =>
      this.nodeToSymbol(document, child)
    );

    return symbol;
  }
}
