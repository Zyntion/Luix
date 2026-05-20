import * as vscode from "vscode";
import { configChangeAffects, getConfig } from "./configCompat";

// ============================================================================
// Roblox Private-Use-Area glyphs
// ============================================================================
//
// Roblox places its custom icon set in the Unicode Private Use Area
// starting at U+E000. VS Code's default fonts have no glyphs for these
// codepoints, so they render as empty boxes (`[]`). We can't change the
// font, but we can:
//   1. Annotate each occurrence with an inlay hint that names it.
//   2. Surface a hover tooltip with the name + codepoint.
//   3. Offer a completion (`:robux:`, `:premium:`, …) inside strings so
//      users can insert the literal char without paste-from-docs gymnastics.

export interface RobloxGlyph {
  /** Codepoint, e.g. 0xE002. */
  codepoint: number;
  /** Display name (used by hover + inlay hint). */
  name: string;
  /** Slug used by the `:` completion trigger. */
  slug: string;
}

export const ROBLOX_GLYPHS: RobloxGlyph[] = [
  { codepoint: 0xe000, name: "Verified", slug: "verified" },
  { codepoint: 0xe001, name: "Premium", slug: "premium" },
  { codepoint: 0xe002, name: "Robux", slug: "robux" },
  { codepoint: 0xe003, name: "Roblox Plus", slug: "roblox-plus" },
];

const BY_CODEPOINT = new Map<number, RobloxGlyph>(
  ROBLOX_GLYPHS.map((g) => [g.codepoint, g])
);

// Single regex that matches any of our glyph codepoints. Used as a
// fast reject in `findGlyphOccurrences` — most Luau files contain no
// PUA glyphs at all, and `text.search(...)` short-circuits at the first
// non-match without iterating every character.
const ANY_GLYPH_RE = new RegExp(
  "[" +
    ROBLOX_GLYPHS.map((g) => `\\u{${g.codepoint.toString(16)}}`).join("") +
    "]",
  "u"
);

function formatCodepoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatHoverMarkdown(glyph: RobloxGlyph): vscode.MarkdownString {
  const hex = glyph.codepoint.toString(16).toUpperCase().padStart(4, "0");
  const md = new vscode.MarkdownString(
    `**Roblox glyph — ${glyph.name}**\n\n` +
      `Codepoint: \`${formatCodepoint(glyph.codepoint)}\`\n\n` +
      `Luau escape: \`\\u{${hex}}\`\n\n` +
      `_VS Code can't render this glyph, but it shows correctly in-game._`
  );
  md.isTrusted = false;
  return md;
}

/**
 * Scan a document for codepoints in our glyph set. Returns one entry per
 * occurrence with its document offset.
 */
function findGlyphOccurrences(
  document: vscode.TextDocument
): Array<{ glyph: RobloxGlyph; offset: number; length: number }> {
  const text = document.getText();
  // Fast reject: files with no PUA glyph chars at all skip the
  // per-character scan entirely.
  if (!ANY_GLYPH_RE.test(text)) {
    return [];
  }
  const out: Array<{ glyph: RobloxGlyph; offset: number; length: number }> = [];
  // We need to handle surrogate pairs correctly. The PUA codepoints we
  // care about are all in the BMP (≤ 0xFFFF), so a simple per-code-unit
  // scan is sufficient and avoids the cost of full UTF-16 decoding.
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const glyph = BY_CODEPOINT.get(cp);
    if (glyph) {
      out.push({ glyph, offset: i, length: 1 });
    }
  }
  return out;
}

// ============================================================================
// Inlay hints — labels at each glyph position
// ============================================================================

export class RobloxGlyphInlayHintsProvider
  implements vscode.InlayHintsProvider, vscode.Disposable
{
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (configChangeAffects(e, "robloxGlyphs")) {
          this._onDidChange.fire();
        }
      })
    );
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    if (!getConfig<boolean>("robloxGlyphs.enabled", true)) {
      return [];
    }
    const occurrences = findGlyphOccurrences(document);
    if (occurrences.length === 0) {
      return [];
    }
    const startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);
    const hints: vscode.InlayHint[] = [];
    for (const occ of occurrences) {
      if (occ.offset < startOffset || occ.offset > endOffset) {
        continue;
      }
      const pos = document.positionAt(occ.offset + occ.length);
      const hint = new vscode.InlayHint(
        pos,
        `${occ.glyph.name}`,
        vscode.InlayHintKind.Type
      );
      hint.paddingLeft = true;
      hint.paddingRight = true;
      hint.tooltip = formatHoverMarkdown(occ.glyph);
      hints.push(hint);
    }
    return hints;
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
// Hover — name + codepoint when the user hovers any glyph
// ============================================================================

export class RobloxGlyphHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    if (!getConfig<boolean>("robloxGlyphs.enabled", true)) {
      return undefined;
    }
    // We only need the single character under the cursor — reading the
    // full document text (potentially hundreds of KB) just to inspect
    // one code point allocates a fresh string on every hover.
    const line = document.lineAt(position.line).text;
    if (position.character >= line.length) {
      return undefined;
    }
    const cp = line.charCodeAt(position.character);
    const glyph = BY_CODEPOINT.get(cp);
    if (!glyph) {
      return undefined;
    }
    const range = new vscode.Range(
      position,
      position.translate(0, 1)
    );
    return new vscode.Hover(formatHoverMarkdown(glyph), range);
  }
}

// ============================================================================
// Completion — `:robux`, `:premium`, … inside a string inserts the glyph
// ============================================================================

export class RobloxGlyphCompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    if (!getConfig<boolean>("robloxGlyphs.enabled", true)) {
      return undefined;
    }
    const text = document.getText();
    const offset = document.offsetAt(position);
    // Find the `:` that opens the trigger sequence and verify there's
    // nothing weird between it and the cursor.
    let i = offset - 1;
    while (i >= 0 && /[a-zA-Z0-9-]/.test(text[i])) {
      i--;
    }
    if (text[i] !== ":") {
      return undefined;
    }
    const colonOffset = i;
    // Only fire inside a single-line string (the same rule the RichText
    // provider uses — keeps `:` in code paths like `obj:method()` alone).
    if (!isInsideSingleLineString(text, colonOffset)) {
      return undefined;
    }

    const range = new vscode.Range(
      document.positionAt(colonOffset),
      document.positionAt(offset)
    );

    const builtins = ROBLOX_GLYPHS.map((glyph, index) => {
      const item = new vscode.CompletionItem(
        `:${glyph.slug}:`,
        vscode.CompletionItemKind.Constant
      );
      item.detail = `Roblox glyph — ${glyph.name} (${formatCodepoint(
        glyph.codepoint
      )})`;
      item.documentation = formatHoverMarkdown(glyph);
      item.filterText = `:${glyph.slug}`;
      item.sortText = String(index).padStart(4, "0");
      item.range = range;
      // Insert the literal codepoint so it works in any Lua/Luau string,
      // not just Luau-with-\u{…} escapes.
      item.insertText = String.fromCharCode(glyph.codepoint);
      return item;
    });

    // User-defined entries from `luix.robloxGlyphs.custom`. Reserved
    // slugs from the built-in set are skipped so users can't accidentally
    // shadow `:robux:` etc.
    const custom = getCustomGlyphs();
    const builtinSlugs = new Set(ROBLOX_GLYPHS.map((g) => g.slug));
    const customItems: vscode.CompletionItem[] = [];
    let customIndex = ROBLOX_GLYPHS.length;
    for (const [slug, value] of Object.entries(custom)) {
      if (!slug || builtinSlugs.has(slug)) {
        continue;
      }
      const item = new vscode.CompletionItem(
        `:${slug}:`,
        vscode.CompletionItemKind.Constant
      );
      item.detail = `Custom glyph — inserts \`${value}\``;
      item.filterText = `:${slug}`;
      item.sortText = String(customIndex++).padStart(4, "0");
      item.range = range;
      item.insertText = value;
      customItems.push(item);
    }

    return [...builtins, ...customItems];
  }
}

function getCustomGlyphs(): Record<string, string> {
  const raw =
    getConfig<Record<string, unknown>>("robloxGlyphs.custom", {}) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.length > 0) {
      out[k] = v;
    }
  }
  return out;
}

function isInsideSingleLineString(text: string, offset: number): boolean {
  let lineStart = offset;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") {
    lineStart--;
  }
  let inString = false;
  let quote: '"' | "'" | "`" | undefined;
  for (let i = lineStart; i < offset; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) {
        inString = false;
        quote = undefined;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      inString = true;
      quote = c;
    }
  }
  return inString;
}
