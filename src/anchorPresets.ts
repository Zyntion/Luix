import * as vscode from "vscode";
import { findEnclosingPropsCall } from "./parser";
import { getAliasPartition } from "./frameworks";

// ============================================================================
// Anchor-preset completion — `anchor:tl|t|tr|l|c|r|bl|b|br`
// ============================================================================
//
// When the cursor is inside a props table, typing `anchor:` opens a
// picker with nine presets. Accepting one replaces `anchor:xx` with a
// matched `AnchorPoint` + `Position = UDim2.fromScale(...)` pair.
// Saves the constant AnchorPoint mental math.

interface Preset {
  slug: string;
  label: string;
  anchorX: number;
  anchorY: number;
}

const PRESETS: Preset[] = [
  { slug: "tl", label: "top-left", anchorX: 0, anchorY: 0 },
  { slug: "t", label: "top", anchorX: 0.5, anchorY: 0 },
  { slug: "tr", label: "top-right", anchorX: 1, anchorY: 0 },
  { slug: "l", label: "left", anchorX: 0, anchorY: 0.5 },
  { slug: "c", label: "centre", anchorX: 0.5, anchorY: 0.5 },
  { slug: "r", label: "right", anchorX: 1, anchorY: 0.5 },
  { slug: "bl", label: "bottom-left", anchorX: 0, anchorY: 1 },
  { slug: "b", label: "bottom", anchorX: 0.5, anchorY: 1 },
  { slug: "br", label: "bottom-right", anchorX: 1, anchorY: 1 },
];

export class AnchorPresetCompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const text = document.getText();
    const cursorOffset = document.offsetAt(position);
    const detected = findEnclosingPropsCall(
      text,
      cursorOffset,
      getAliasPartition()
    );
    if (!detected) {
      return undefined;
    }

    // Find the start of the `anchor:<x>` token under the cursor. Walk
    // back across the identifier-and-colon range so the replacement
    // range covers whatever partial the user has typed (`anchor`,
    // `anchor:`, `anchor:b`, etc.).
    let start = cursorOffset;
    while (start > 0 && /[A-Za-z:]/.test(text[start - 1])) {
      start--;
    }
    const typed = text.slice(start, cursorOffset);
    if (!/^[Aa]/.test(typed) && typed.length > 0) {
      // Don't fire for unrelated tokens. The initial `a` keeps the
      // suggestion list focused; if the user typed something else,
      // they're not asking for an anchor preset.
      return undefined;
    }

    const replaceRange = new vscode.Range(
      document.positionAt(start),
      position
    );

    return PRESETS.map((preset, index) => {
      const item = new vscode.CompletionItem(
        `anchor:${preset.slug}`,
        vscode.CompletionItemKind.Snippet
      );
      item.detail = `Anchor preset — ${preset.label}`;
      item.documentation = new vscode.MarkdownString(
        [
          "Inserts a paired `AnchorPoint` + `Position` so the element ",
          `anchors to **${preset.label}** of its parent.\n\n`,
          "```lua\n",
          renderSnippet(preset, /*forDocs=*/ true),
          "\n```",
        ].join("")
      );
      item.filterText = `anchor:${preset.slug}`;
      item.sortText = String(index).padStart(4, "0");
      item.range = replaceRange;
      item.insertText = new vscode.SnippetString(
        renderSnippet(preset, /*forDocs=*/ false)
      );
      return item;
    });
  }
}

function renderSnippet(preset: Preset, forDocs: boolean): string {
  const ax = fmt(preset.anchorX);
  const ay = fmt(preset.anchorY);
  // For the position, the scale matches the anchor — that way the
  // element's anchor point sits exactly on the corresponding spot of
  // the parent.
  const px = fmt(preset.anchorX);
  const py = fmt(preset.anchorY);
  const tail = forDocs ? "" : "$0";
  return (
    `AnchorPoint = Vector2.new(${ax}, ${ay}),\n` +
    `Position = UDim2.fromScale(${px}, ${py}),${tail}`
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toString();
}
