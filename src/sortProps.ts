import * as vscode from "vscode";
import {
  applyMask,
  buildCodeMask,
  findAllCreateElementCalls,
} from "./parser";
import { getAliasPartition } from "./frameworks";
import { getConfig } from "./configCompat";

// ============================================================================
// Sort props by category — code action + on-save formatter.
//
// Each prop name is assigned to a category. Categories have an order
// (configurable via `luix.sortProps.categoryOrder`). Within a category,
// props are placed in their canonical order. Unknown props fall into
// "Other" and keep their original relative order.
//
// Props are NOT sorted when the table contains comments — we don't try
// to reattach them and don't want to lose the user's intent.
// ============================================================================

const PROP_CATEGORIES: Record<string, string[]> = {
  // Identity / metadata props — typically first thing you read.
  Identification: ["Name", "ClassName", "Key", "Archivable"],

  // Layout — anything that decides where the element lands and how big
  // it is, including layout-item flex extras and size/aspect constraints.
  Layout: [
    "AnchorPoint",
    "Position",
    "Size",
    "SizeOffset",
    "AutomaticSize",
    "Rotation",
    "LayoutOrder",
    "ZIndex",
    "ZIndexBehavior",
    "SizeConstraint",
    "MinSize",
    "MaxSize",
    "AspectRatio",
    "AspectType",
    "DominantAxis",
    // UIPadding
    "Padding",
    "PaddingTop",
    "PaddingRight",
    "PaddingBottom",
    "PaddingLeft",
    // UIListLayout / UIGridLayout / UIPageLayout / UITableLayout
    "FillDirection",
    "FillDirectionMaxCells",
    "HorizontalAlignment",
    "VerticalAlignment",
    "HorizontalFlex",
    "VerticalFlex",
    "ItemLineAlignment",
    "SortOrder",
    "StartCorner",
    "CellPadding",
    "CellSize",
    "ColumnSpacing",
    "RowSpacing",
    "PageSize",
    "MajorAxis",
    // UIFlexItem
    "FlexMode",
    "GrowRatio",
    "ShrinkRatio",
    // UIScale
    "Scale",
    // ScrollingFrame canvas
    "CanvasSize",
    "CanvasPosition",
    "AutomaticCanvasSize",
    "ScrollingDirection",
    "ScrollingEnabled",
    "ScrollWheelInputEnabled",
    "ElasticBehavior",
    "ScrollBarThickness",
    "HorizontalScrollBarInset",
    "VerticalScrollBarInset",
    "VerticalScrollBarPosition",
    "BottomImage",
    "MidImage",
    "TopImage",
    "ScrollBarImageColor3",
    "ScrollBarImageTransparency",
  ],

  // Style — visual surface treatment.
  Style: [
    "BackgroundColor3",
    "BackgroundTransparency",
    "BorderColor3",
    "BorderMode",
    "BorderSizePixel",
    "CornerRadius",
    // UIStroke
    "ApplyStrokeMode",
    "Color",
    "Thickness",
    "LineJoinMode",
    "Transparency",
    "BorderOffset",
    "BorderStrokePosition",
    "StrokeSizingMode",
    // UIGradient
    "Offset",
    // CanvasGroup
    "GroupColor3",
    "GroupTransparency",
    // ViewportFrame lighting
    "Ambient",
    "LightColor",
    "LightDirection",
    "LightInfluence",
  ],

  Visibility: ["Visible", "ClipsDescendants", "Enabled"],

  Image: [
    "Image",
    "ImageColor3",
    "ImageTransparency",
    "ImageRectOffset",
    "ImageRectSize",
    "ScaleType",
    "SliceCenter",
    "SliceScale",
    "TileSize",
    "ResampleMode",
    "HoverImage",
    "PressedImage",
  ],

  Text: [
    "Text",
    "TextColor3",
    "TextSize",
    "MaxTextSize",
    "MinTextSize",
    "TextScaled",
    "TextWrapped",
    "FontFace",
    "Font",
    "OpenTypeFeatures",
    "RichText",
    "TextXAlignment",
    "TextYAlignment",
    "TextDirection",
    "LineHeight",
    "TextTransparency",
    "TextStrokeColor3",
    "TextStrokeTransparency",
    "TextTruncate",
    "MaxVisibleGraphemes",
    "PlaceholderText",
    "PlaceholderColor3",
    "ClearTextOnFocus",
    "MultiLine",
    "CursorPosition",
    "SelectionStart",
    "ShowNativeInput",
    "TextEditable",
  ],

  // Behavior — interaction / runtime / lifecycle.
  Behavior: [
    "Active",
    "Selectable",
    "Interactable",
    "AutoButtonColor",
    "Modal",
    "Selected",
    "Style",
    // Input + selection
    "InputSink",
    "SelectionOrder",
    "SelectionImageObject",
    "SelectionGroup",
    "SelectionBehaviorDown",
    "SelectionBehaviorLeft",
    "SelectionBehaviorRight",
    "SelectionBehaviorUp",
    "NextSelectionDown",
    "NextSelectionLeft",
    "NextSelectionRight",
    "NextSelectionUp",
    "GamepadInputEnabled",
    "TouchInputEnabled",
    "TabKeyboardNavigation",
    "HoverHapticEffect",
    "PressHapticEffect",
    // Localisation
    "AutoLocalize",
    "RootLocalizationTable",
    // Layer collector / Gui root
    "DisplayOrder",
    "IgnoreGuiInset",
    "ResetOnSpawn",
    "SafeAreaCompatibility",
    "ScreenInsets",
    "ClipToDeviceSafeArea",
    // BillboardGui / SurfaceGui adornment
    "Adornee",
    "AlwaysOnTop",
    "Brightness",
    "DistanceLowerLimit",
    "DistanceStep",
    "DistanceUpperLimit",
    "ExtentsOffset",
    "ExtentsOffsetWorldSpace",
    "Face",
    "MaxDistance",
    "PixelsPerStud",
    "PlayerToHideFrom",
    "SizingMode",
    "StudsOffset",
    "StudsOffsetWorldSpace",
    "ToolPunchThroughDistance",
    // ViewportFrame
    "CurrentCamera",
    // VideoFrame / audio playback
    "Looped",
    "Playing",
    "TimePosition",
    "Video",
    "Volume",
    "MaximumResolution",
    "RollOffMaxDistance",
    "RollOffMinDistance",
    "RollOffMode",
    // Misc
    "Animated",
    "Circular",
    "FillEmptySpaceColumns",
    "FillEmptySpaceRows",
    "Wraps",
  ],

  // Events / Refs / Children / Other are catch-alls — populated by the
  // categorize() rules below.
  Events: [],
  Refs: ["ref", "key"],
  Children: [],
  Other: [],
};

export const DEFAULT_CATEGORY_ORDER = [
  "Identification",
  "Layout",
  "Style",
  "Visibility",
  "Image",
  "Text",
  "Behavior",
  "Events",
  "Refs",
  "Children",
  "Other",
];

interface Category {
  name: string;
  position: number;
}

function categorize(key: string): Category {
  // Built-in explicit-prop categories
  for (const [name, props] of Object.entries(PROP_CATEGORIES)) {
    const idx = props.indexOf(key);
    if (idx >= 0) {
      return { name, position: idx };
    }
  }
  // Pattern-based catch-alls
  if (key === "[Children]" || key === "children") {
    return { name: "Children", position: 0 };
  }
  if (/^\[.*Event.*\]$/i.test(key) || /^\[.*Change.*\]$/i.test(key)) {
    return { name: "Events", position: 0 };
  }
  if (/^\[OnEvent/i.test(key) || /^\[OnChange/i.test(key)) {
    return { name: "Events", position: 0 };
  }
  // Vide-style: event names as plain identifiers (Activated, MouseEnter, …)
  if (/^(Activated|MouseButton[12](Click|Down|Up)|MouseEnter|MouseLeave|MouseMoved|InputBegan|InputChanged|InputEnded|FocusLost|Focused|TouchTap|TouchPan|TouchPinch|SelectionGained|SelectionLost)$/.test(key)) {
    return { name: "Events", position: 0 };
  }
  return { name: "Other", position: 0 };
}

// ============================================================================
// Scanner — captures BOTH plain keys (`Name = …`) and computed keys
// (`[React.Event.Activated] = …`). The shared `extractPropEntries`
// skips computed keys, so we duplicate the small bit of parsing here.
// ============================================================================
interface SortableEntry {
  key: string;
  start: number; // offset of the key in the body
  end: number;   // offset just after the value
}

function extractSortableEntries(body: string): SortableEntry[] {
  const masked = applyMask(body, buildCodeMask(body));
  const entries: SortableEntry[] = [];
  let i = 0;
  while (i < masked.length) {
    // Skip whitespace + separators.
    while (i < masked.length && /[\s,;]/.test(masked[i])) {
      i++;
    }
    if (i >= masked.length) {
      break;
    }
    const start = i;
    let key: string;
    if (masked[i] === "[") {
      // Computed key — match up to balanced `]`
      let depth = 1;
      let j = i + 1;
      while (j < masked.length && depth > 0) {
        if (masked[j] === "[") depth++;
        else if (masked[j] === "]") depth--;
        j++;
      }
      key = body.slice(i, j);
      i = j;
    } else if (/[A-Za-z_]/.test(masked[i])) {
      const ks = i;
      while (i < masked.length && /\w/.test(masked[i])) {
        i++;
      }
      key = body.slice(ks, i);
    } else {
      // Positional value or junk — skip past it.
      i = skipValueExpression(masked, i);
      continue;
    }
    // Require '=' next.
    while (i < masked.length && /\s/.test(masked[i])) {
      i++;
    }
    if (masked[i] !== "=") {
      // No assignment — abandon this entry; skip whatever it was.
      continue;
    }
    i++;
    while (i < masked.length && /\s/.test(masked[i])) {
      i++;
    }
    i = skipValueExpression(masked, i);
    entries.push({ key, start, end: i });
  }
  return entries;
}

function skipValueExpression(masked: string, start: number): number {
  let i = start;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  while (i < masked.length) {
    const c = masked[i];
    if (
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      (c === "," || c === ";")
    ) {
      break;
    }
    if (
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      c === "}"
    ) {
      // Reached the table's closer — caller handles.
      break;
    }
    if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    else if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    else if (c === "[") bracketDepth++;
    else if (c === "]") bracketDepth--;
    i++;
  }
  return i;
}

// ============================================================================
// Body-has-comments detection — we bail rather than risk losing comments.
// ============================================================================
function bodyHasComments(body: string): boolean {
  let i = 0;
  let inString: string | null = null;
  while (i < body.length - 1) {
    const c = body[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      i++;
      continue;
    }
    if (c === "-" && body[i + 1] === "-") {
      return true;
    }
    i++;
  }
  return false;
}

// ============================================================================
// Main sort
// ============================================================================
export function sortPropsBody(
  body: string,
  categoryOrder: string[]
): string | undefined {
  if (bodyHasComments(body)) {
    return undefined;
  }
  const entries = extractSortableEntries(body);
  if (entries.length < 2) {
    return undefined;
  }

  // Detect the per-line indent — leading whitespace of the line that
  // contains the first entry's key.
  const firstKeyStart = entries[0].start;
  let lineStart = firstKeyStart;
  while (lineStart > 0 && body[lineStart - 1] !== "\n") {
    lineStart--;
  }
  const indent = body.slice(lineStart, firstKeyStart);
  if (!/^[ \t]*$/.test(indent)) {
    // Something non-whitespace precedes the first entry on its line —
    // probably `{` and `Name = …` on the same line. Bail; one-liners
    // aren't worth reformatting.
    return undefined;
  }

  // Trailing whitespace before the closing `}` — preserve as-is.
  const trailingMatch = /\n([ \t]*)$/.exec(body);
  const trailingIndent = trailingMatch ? trailingMatch[1] : "";

  const catIndex = new Map<string, number>();
  categoryOrder.forEach((c, i) => catIndex.set(c, i));
  const fallbackOrder = catIndex.get("Other") ?? 999;

  const decorated = entries.map((e, originalIdx) => {
    const cat = categorize(e.key);
    const order = catIndex.get(cat.name) ?? fallbackOrder;
    return { ...e, originalIdx, catName: cat.name, catPos: cat.position, order };
  });

  decorated.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.catPos !== b.catPos) return a.catPos - b.catPos;
    return a.originalIdx - b.originalIdx;
  });

  // No-op when already sorted.
  if (decorated.every((e, i) => e.originalIdx === i)) {
    return undefined;
  }

  const lines = decorated.map(
    (e) => indent + body.slice(e.start, e.end) + ","
  );
  return "\n" + lines.join("\n") + "\n" + trailingIndent;
}

/**
 * Recursively sort a body together with every nested createElement
 * call's body, splicing the sorted nested bodies into the parent's
 * working copy *before* sorting the parent. Returns the fully sorted
 * body, or `undefined` when nothing in the subtree changed (so the
 * caller can skip emitting an edit).
 *
 * Children are spliced from end-to-start so each splice doesn't shift
 * the offsets of children we haven't visited yet — same trick the rest
 * of the codebase uses for in-place body edits.
 */
function sortBodyRecursive(
  text: string,
  bodyStart: number,
  bodyEnd: number,
  allCalls: Array<{
    propsBraceStart: number;
    propsBraceEnd: number;
  }>,
  categoryOrder: string[]
): string | undefined {
  let body = text.slice(bodyStart, bodyEnd);
  let changed = false;

  // Calls strictly inside this body — both endpoints inside (bodyStart,
  // bodyEnd) — then narrow to DIRECT children so we don't double-process
  // grandchildren (they get handled when we recurse into the child).
  const inside = allCalls.filter(
    (c) =>
      c.propsBraceStart > bodyStart && c.propsBraceEnd < bodyEnd
  );
  const directChildren = inside
    .filter(
      (c) =>
        !inside.some(
          (other) =>
            other !== c &&
            other.propsBraceStart < c.propsBraceStart &&
            c.propsBraceEnd < other.propsBraceEnd
        )
    )
    .sort((a, b) => b.propsBraceStart - a.propsBraceStart);

  for (const child of directChildren) {
    const innerSorted = sortBodyRecursive(
      text,
      child.propsBraceStart + 1,
      child.propsBraceEnd,
      allCalls,
      categoryOrder
    );
    if (innerSorted !== undefined) {
      const localStart = child.propsBraceStart + 1 - bodyStart;
      const localEnd = child.propsBraceEnd - bodyStart;
      body = body.slice(0, localStart) + innerSorted + body.slice(localEnd);
      changed = true;
    }
  }

  const sortedSelf = sortPropsBody(body, categoryOrder);
  if (sortedSelf !== undefined) {
    body = sortedSelf;
    changed = true;
  }

  return changed ? body : undefined;
}

// ============================================================================
// Code action — manual "Sort props by category"
// ============================================================================
export class SortPropsCodeActionProvider
  implements vscode.CodeActionProvider
{
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.RefactorRewrite,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] | undefined {
    const lang = document.languageId;
    if (lang !== "lua" && lang !== "luau") {
      return undefined;
    }
    const text = document.getText();
    // Fast reject: nothing to sort in a file without any element factory
    // call. Skips the full createElement-scan + cursor-walk for huge
    // non-UI files when the user is just navigating around.
    if (text.indexOf("(") === -1 || text.indexOf("{") === -1) {
      return undefined;
    }
    const cursor = document.offsetAt(range.start);
    const aliases = getAliasPartition();
    const calls = findAllCreateElementCalls(text, aliases);
    // Smallest call whose props brace contains the cursor.
    let match: typeof calls[number] | undefined;
    for (const c of calls) {
      if (
        c.propsBraceStart === undefined ||
        c.propsBraceEnd === undefined
      ) {
        continue;
      }
      if (cursor >= c.propsBraceStart && cursor <= c.propsBraceEnd) {
        if (
          !match ||
          c.fullEnd - c.aliasStart < match.fullEnd - match.aliasStart
        ) {
          match = c;
        }
      }
    }
    if (
      !match ||
      match.propsBraceStart === undefined ||
      match.propsBraceEnd === undefined
    ) {
      return undefined;
    }
    const bodyStart = match.propsBraceStart + 1;
    const bodyEnd = match.propsBraceEnd;
    const body = text.slice(bodyStart, bodyEnd);
    const order = getConfig<string[]>(
      "sortProps.categoryOrder",
      DEFAULT_CATEGORY_ORDER
    );
    const sorted = sortPropsBody(body, order);
    if (!sorted) {
      return undefined;
    }
    const action = new vscode.CodeAction(
      `Sort props by category`,
      vscode.CodeActionKind.RefactorRewrite
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(bodyStart),
        document.positionAt(bodyEnd)
      ),
      sorted
    );
    return [action];
  }
}

// ============================================================================
// On-save formatter — runs across every props table in the document
// when `luix.sortProps.onSave` is true (default false).
// ============================================================================
export class SortPropsOnSaveListener implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.workspace.onWillSaveTextDocument((e) =>
      this.onWillSave(e)
    );
  }

  private onWillSave(event: vscode.TextDocumentWillSaveEvent): void {
    if (!getConfig<boolean>("sortProps.onSave", false)) {
      return;
    }
    // Skip non-disk saves (git, vscode-userdata, diff views, …). Those
    // can still report `languageId === "lua"` but we shouldn't reshape
    // them.
    if (event.document.uri.scheme !== "file") {
      return;
    }
    const lang = event.document.languageId;
    if (lang !== "lua" && lang !== "luau") {
      return;
    }
    event.waitUntil(this.computeEdits(event.document));
  }

  private async computeEdits(
    document: vscode.TextDocument
  ): Promise<vscode.TextEdit[]> {
    const text = document.getText();
    const aliases = getAliasPartition();
    const calls = findAllCreateElementCalls(text, aliases).filter(
      (c): c is typeof c & {
        propsBraceStart: number;
        propsBraceEnd: number;
      } =>
        c.propsBraceStart !== undefined && c.propsBraceEnd !== undefined
    );
    if (calls.length === 0) {
      return [];
    }
    const order = getConfig<string[]>(
      "sortProps.categoryOrder",
      DEFAULT_CATEGORY_ORDER
    );

    // Per-call edits used to overlap when an outer createElement
    // contained inner ones (the canonical UI shape — `Frame` with
    // children) — VS Code rejects overlapping TextEdits and aborts the
    // whole save formatter, silently. Fix: only emit one edit per
    // *outer-most* call; sortBodyRecursive splices the sorted nested
    // bodies into the outer's body before we sort the outer itself, so
    // a single non-overlapping edit covers the full tree.
    const isStrictlyInside = (
      inner: { propsBraceStart: number; propsBraceEnd: number },
      outer: { propsBraceStart: number; propsBraceEnd: number }
    ) =>
      outer.propsBraceStart < inner.propsBraceStart &&
      inner.propsBraceEnd < outer.propsBraceEnd;

    const topLevel = calls.filter(
      (c) => !calls.some((o) => o !== c && isStrictlyInside(c, o))
    );

    const edits: vscode.TextEdit[] = [];
    for (const top of topLevel) {
      const start = top.propsBraceStart + 1;
      const end = top.propsBraceEnd;
      const sorted = sortBodyRecursive(text, start, end, calls, order);
      if (sorted === undefined) continue;
      edits.push(
        vscode.TextEdit.replace(
          new vscode.Range(
            document.positionAt(start),
            document.positionAt(end)
          ),
          sorted
        )
      );
    }
    return edits;
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
