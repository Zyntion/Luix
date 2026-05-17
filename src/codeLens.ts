import * as vscode from "vscode";
import { configChangeAffects, getConfig } from "./configCompat";
import { getAliasPartition } from "./frameworks";
import { scanDocument } from "./parser";
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
