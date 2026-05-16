import * as vscode from "vscode";
import { getConfig } from "./configCompat";

export type Palette = Record<string, string>;

export function getPalette(): Palette {
  return getConfig<Palette>("palette", {}) ?? {};
}

/**
 * Provides completion items for `luix.palette` entries when the cursor
 * is right after `Color3.`. Accepting an entry replaces `Color3.` with
 * the full configured expression so the inserted text is the canonical
 * Color3 form, not a Luau-invalid `Color3.primary`.
 */
export class PaletteCompletionProvider
  implements vscode.CompletionItemProvider
{
  static readonly TRIGGER = ".";

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    const before = lineText.slice(0, position.character);
    if (!/Color3\.$/.test(before)) {
      return undefined;
    }
    const palette = getPalette();
    return buildPaletteCompletions(palette, position);
  }
}

export function buildPaletteCompletions(
  palette: Palette,
  position: vscode.Position
): vscode.CompletionItem[] {
  const entries = Object.entries(palette);
  if (entries.length === 0) {
    return [];
  }
  // Replace the trailing `Color3.` (7 chars) so the final inserted text
  // is the canonical Color3.fromRGB(...) expression.
  const range = new vscode.Range(
    new vscode.Position(position.line, position.character - "Color3.".length),
    position
  );
  return entries.map(([name, value], index) => {
    const item = new vscode.CompletionItem(
      `palette.${name}`,
      vscode.CompletionItemKind.Color
    );
    item.insertText = value;
    item.range = range;
    item.detail = value;
    item.documentation = new vscode.MarkdownString(
      `**Luix palette** — \`${name}\`\n\n\`${value}\``
    );
    item.filterText = `Color3.palette.${name}`;
    item.sortText = String(index).padStart(4, "0");
    return item;
  });
}
