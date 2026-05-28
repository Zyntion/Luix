import * as vscode from "vscode";
import {
  applyMask,
  buildCodeMask,
  findAllCreateElementCalls,
  scanDocument,
} from "./parser";
import { getAliasPartition } from "./frameworks";
import { WorkspaceIndex } from "./workspaceIndex";
import { logWarn } from "./output";

// ============================================================================
// Workspace-wide component rename — `vscode.RenameProvider` for Lua/Luau
// ============================================================================
//
// Why this exists: luau-lsp's rename only sees identifiers it can resolve
// through types. For Vide / Fusion custom components — invoked via the
// bare-call shape `MyButton({ … })` / `MyButton { … }` — luau-lsp
// frequently can't tie the call back to the function definition, so a
// rename misses half the call sites. Luix's workspace index already
// knows every component and every reference, across all four supported
// frameworks; this provider exposes that to F2.
//
// Coverage:
//
//   - The component's `local function MyButton(…)` or
//     `local MyButton = function(…)` definition.
//   - Every `e(MyButton, …)` / `Roact.createElement(MyButton, …)` call
//     site (parens form) — picked up via `findAllCreateElementCalls`.
//   - Every `MyButton({ … })` / `MyButton { … }` direct call site
//     (curried form, Vide/Fusion idiom) — walked manually because the
//     index doesn't track these yet.
//
// Out of scope for v1 (deliberate):
//
//   - Property-access references like `Components.MyButton` — those
//     need the user to also rename the export key, which is the
//     module's choice.
//   - The `require("…/MyButton")` path basename — that's a filename,
//     not an identifier; renaming the file is a separate workflow.
//   - Bare variable references (`local x = MyButton`) — too easy to
//     false-positive on common names.

export class ComponentRenameProvider implements vscode.RenameProvider {
  constructor(private readonly workspaceIndex: WorkspaceIndex) {}

  /**
   * Validates that the symbol under the cursor is something we can
   * rename. Returns the *range* of the identifier so VS Code's rename
   * UI shows the user exactly what's about to change.
   *
   * Conservative: only accepts identifiers Luix's workspace index has
   * already classified as a component. That way pressing F2 on a
   * random local variable just gets luau-lsp's behaviour (or an
   * "element can't be renamed" message) rather than us silently
   * doing something surprising.
   */
  async prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Range | { range: vscode.Range; placeholder: string }> {
    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );
    if (!wordRange) {
      throw new Error("Place the cursor on a component identifier.");
    }
    const name = document.getText(wordRange);
    if (!isValidIdentifier(name)) {
      throw new Error("Not a valid Lua identifier.");
    }

    // The name must be a known workspace component — either defined in
    // *this* file or in another file the index already saw.
    const knownNames = this.workspaceIndex.knownComponentNames();
    if (!knownNames.has(name)) {
      throw new Error(
        `'${name}' isn't a Luix-tracked component — Luix can only rename ` +
          `components it has indexed (workspace functions that return an ` +
          `element call or carry a Luix annotation).`
      );
    }

    return { range: wordRange, placeholder: name };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken
  ): Promise<vscode.WorkspaceEdit | undefined> {
    if (!isValidIdentifier(newName)) {
      throw new Error(
        `'${newName}' isn't a valid Lua identifier — use letters, digits, and underscores; start with a letter or underscore.`
      );
    }

    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );
    if (!wordRange) return undefined;
    const oldName = document.getText(wordRange);
    if (oldName === newName) return undefined;

    // Refuse to clobber an existing component — same-name collisions
    // are almost always a mistake and would produce two definitions
    // the lookup table can't tell apart.
    const known = this.workspaceIndex.knownComponentNames();
    if (known.has(newName)) {
      throw new Error(
        `A component named '${newName}' already exists in this workspace.`
      );
    }

    const edit = new vscode.WorkspaceEdit();

    // Always include the current document, since unsaved buffers might
    // contain the only definition or fresh occurrences the file-system
    // walk below would miss.
    await this.collectEditsForDocument(document, oldName, newName, edit);

    // Walk every other workspace file the index has indexed.
    // `_internal` would be nicer but we don't have it; instead, ask the
    // index for the list of URIs by exporting an accessor — but to keep
    // the change small we use `findCallSites` to find files with hits
    // (covers indirect-call sites) and supplement by walking every
    // indexed file via `vscode.workspace.findFiles` (covers definitions
    // in files the call-site index missed, e.g. modules that only
    // export the component).
    const aliases = getAliasPartition();
    const sitesByName = await this.workspaceIndex.findCallSites(oldName);
    const seenUris = new Set<string>([document.uri.toString()]);

    // Files surfaced by `findCallSites` — these have at least one
    // createElement-style reference.
    for (const site of sitesByName) {
      if (token.isCancellationRequested) return undefined;
      const key = site.uri.toString();
      if (seenUris.has(key)) continue;
      seenUris.add(key);
      try {
        const doc = await vscode.workspace.openTextDocument(site.uri);
        await this.collectEditsForDocument(doc, oldName, newName, edit);
      } catch (err) {
        logWarn(`Rename: failed to open ${site.uri.fsPath}`, err);
      }
    }

    // Catch the defining file + any file that has a direct call but no
    // createElement call. Skip vendored / Packages.
    const candidates = await vscode.workspace.findFiles(
      "**/*.{lua,luau}",
      "**/{Packages,DevPackages,ServerPackages,_Index,node_modules}/**"
    );
    for (const uri of candidates) {
      if (token.isCancellationRequested) return undefined;
      const key = uri.toString();
      if (seenUris.has(key)) continue;
      seenUris.add(key);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        // Quick reject — if the bare word doesn't appear in the file,
        // skip. Avoids parsing every irrelevant file in the workspace.
        if (!containsWord(doc.getText(), oldName)) continue;
        await this.collectEditsForDocument(doc, oldName, newName, edit);
      } catch (err) {
        logWarn(`Rename: failed to open ${uri.fsPath}`, err);
      }
    }

    void aliases; // touch to keep alias-partition cache warm during rename
    return edit;
  }

  /**
   * Gather every range in `doc` that should be replaced with `newName`
   * when renaming `oldName`. Pushes edits into `edit` in place.
   *
   * Three kinds of occurrences:
   *
   *   1. The function *definition* — `local function X(`, `function X(`,
   *      `local X = function(`. The identifier portion is what we
   *      replace; the keywords and parens are untouched.
   *   2. createElement-style call sites — `e(X, …)`, etc. — picked
   *      up via `findAllCreateElementCalls` so the same logic the
   *      reference CodeLens relies on covers us here too.
   *   3. Direct-call sites — `X({…})` and `X {…}` — walked manually
   *      against the masked text (so we don't trip on `"X("` strings
   *      or `--[[ X { ]]` comments).
   */
  private async collectEditsForDocument(
    doc: vscode.TextDocument,
    oldName: string,
    newName: string,
    edit: vscode.WorkspaceEdit
  ): Promise<void> {
    const text = doc.getText();
    const aliases = getAliasPartition();
    // Track every offset we've already queued an edit for in this
    // document, so the direct-call pass (which uses a coarse
    // `IDENT(...) | IDENT { ... }` regex) doesn't double-edit a
    // createElement reference we already covered.
    const edited = new Set<number>();
    const queue = (start: number, end: number) => {
      if (edited.has(start)) return;
      edited.add(start);
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(start), doc.positionAt(end)),
        newName
      );
    };

    // --- (1) Function definitions ---------------------------------------
    const components = scanDocument(text, aliases);
    const def = components.get(oldName);
    if (def) {
      const line = doc.lineAt(def.defLineIndex);
      const idxInLine = findWordOnLine(line.text, oldName);
      if (idxInLine !== -1) {
        const lineStartOffset = doc.offsetAt(
          new vscode.Position(def.defLineIndex, 0)
        );
        queue(lineStartOffset + idxInLine, lineStartOffset + idxInLine + oldName.length);
      }
    }

    // --- (2) Indexed createElement call sites ---------------------------
    for (const call of findAllCreateElementCalls(text, aliases)) {
      if (call.isStringLiteralName) continue;
      // Drop trailing `.X.Y` namespace segments — workspace index keys
      // by the last segment, so `Module.Card` is the same target as
      // `Card`. Only rename when the *last* segment matches and the
      // call is rendered as a bare identifier (no Module prefix).
      if (call.className !== oldName) continue;
      queue(call.classNameStart, call.classNameEnd);
    }

    // --- (3) Direct-call sites (Vide / Fusion idiom) --------------------
    const masked = applyMask(text, buildCodeMask(text));
    // Whole-word match, followed by `(` or `{` (with optional ws), and
    // *not* preceded by `.`, `:`, or identifier chars (mid-identifier).
    // Same conservative shape the direct-call detection in
    // `findEnclosingPropsCall` uses.
    const re = new RegExp(
      `(?<![A-Za-z0-9_.:])(${escapeRegex(oldName)})\\s*[({]`,
      "g"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const start = m.index;
      const end = start + oldName.length;
      // `edited.has(start)` covers the createElement-duplication case
      // above; the function-definition line is also already in the set.
      queue(start, end);
    }
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isValidIdentifier(name: string): boolean {
  return IDENT_RE.test(name);
}

/** Cheap pre-filter — true if `text` contains `word` as a standalone
 *  identifier somewhere. Used by the workspace walk to avoid parsing
 *  files that obviously don't reference the component. */
function containsWord(text: string, word: string): boolean {
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(word)}(?![A-Za-z0-9_])`);
  return re.test(text);
}

/** Find the column offset of the first whole-word occurrence of
 *  `word` on `line`, or -1. */
function findWordOnLine(line: string, word: string): number {
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(word)}(?![A-Za-z0-9_])`);
  const m = re.exec(line);
  return m ? m.index : -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+*?^$()[\]{}|\\]/g, "\\$&");
}
