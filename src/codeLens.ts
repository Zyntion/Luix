import * as vscode from "vscode";
import { configChangeAffects, getConfig } from "./configCompat";
import { getAliasPartition } from "./frameworks";
import {
  buildCallTree,
  CallTreeNode,
  findAllCreateElementCalls,
  scanDocument,
} from "./parser";
import { WorkspaceIndex } from "./workspaceIndex";

/**
 * Surface a `▸ N references` CodeLens above every component definition
 * in a Lua/Luau file. Clicking it opens VS Code's standard references
 * peek for that location, listing every workspace `e(MyButton, …)` call
 * site the index knows about.
 */
export class ComponentReferencesLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly workspaceIndex: WorkspaceIndex) {
    this.disposables.push(
      this.workspaceIndex.onDidChangeIndex(() => this._onDidChange.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (configChangeAffects(e, "componentReferencesLens")) {
          this._onDidChange.fire();
        }
      })
    );
  }

  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    if (!getConfig<boolean>("componentReferencesLens.enabled", true)) {
      return [];
    }
    const text = document.getText();
    const components = scanDocument(text, getAliasPartition());
    if (components.size === 0) {
      return [];
    }
    const lines = text.split("\n");
    const out: vscode.CodeLens[] = [];
    for (const [name, info] of components) {
      const line = lines[info.defLineIndex] ?? "";
      // Anchor the lens at the line of the function definition. Indent
      // by the existing leading whitespace so it lines up with the body
      // visually rather than the literal column 0.
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const pos = new vscode.Position(info.defLineIndex, indent.length);
      const range = new vscode.Range(pos, pos);

      const sites = await this.workspaceIndex.findCallSites(name);
      // Exclude self-references inside the defining function body if
      // we can identify them — heuristic: same file, lens line.
      const externalCount = sites.filter(
        (s) =>
          s.uri.toString() !== document.uri.toString() ||
          s.range.start.line !== info.defLineIndex
      ).length;

      const title =
        externalCount === 0
          ? "No references"
          : externalCount === 1
            ? "1 reference"
            : `${externalCount} references`;

      const lens = new vscode.CodeLens(range, {
        title,
        command:
          externalCount === 0 ? "" : "editor.action.showReferences",
        arguments:
          externalCount === 0
            ? []
            : [document.uri, pos, sites.map((s) =>
                new vscode.Location(s.uri, s.range)
              )],
      });
      out.push(lens);
    }
    return out;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this._onDidChange.dispose();
  }
}

// ============================================================================
// Frame-stats CodeLens
// ============================================================================
//
// Off by default. When enabled, every element call gets `▸ N
// descendants, D layers` above its opening line. Useful for sanity-
// checking layout depth and catching subtrees that have grown out of
// hand (Roblox renders slow when you nest too many UI instances).

export class FrameStatsLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (configChangeAffects(e, "frameStatsLens")) {
          this._onDidChange.fire();
        }
      })
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!getConfig<boolean>("frameStatsLens.enabled", false)) {
      return [];
    }
    const minDescendants = getConfig<number>(
      "frameStatsLens.minDescendants",
      5
    );
    const text = document.getText();
    const calls = findAllCreateElementCalls(text, getAliasPartition());
    if (calls.length === 0) return [];
    const tree = buildCallTree(calls);
    const out: vscode.CodeLens[] = [];
    for (const root of tree) {
      this.walk(root, document, out, minDescendants);
    }
    return out;
  }

  private walk(
    node: CallTreeNode,
    document: vscode.TextDocument,
    out: vscode.CodeLens[],
    minDescendants: number
  ): void {
    const stats = countStats(node);
    if (stats.descendants >= minDescendants) {
      const pos = document.positionAt(node.call.aliasStart);
      const lineIndent = /^\s*/.exec(
        document.lineAt(pos.line).text
      )?.[0] ?? "";
      const lensPos = new vscode.Position(pos.line, lineIndent.length);
      const lens = new vscode.CodeLens(new vscode.Range(lensPos, lensPos), {
        title: `▸ ${node.call.className} — ${stats.descendants} descendant${stats.descendants === 1 ? "" : "s"}, ${stats.depth} layer${stats.depth === 1 ? "" : "s"} deep`,
        command: "",
      });
      out.push(lens);
    }
    for (const child of node.children) {
      this.walk(child, document, out, minDescendants);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this._onDidChange.dispose();
  }
}

function countStats(
  node: CallTreeNode
): { descendants: number; depth: number } {
  let descendants = 0;
  let maxChildDepth = 0;
  for (const child of node.children) {
    descendants++;
    const s = countStats(child);
    descendants += s.descendants;
    if (s.depth > maxChildDepth) maxChildDepth = s.depth;
  }
  return { descendants, depth: 1 + maxChildDepth };
}
