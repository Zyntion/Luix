import * as vscode from "vscode";
import { buildCodeMask, findEnclosingPropsCall } from "./parser";
import { flattenClassEvents, flattenClassProps } from "./data";
import {
  FrameworkId,
  findFrameworkForAlias,
  getAliasPartition,
  getEnabledFrameworks,
} from "./frameworks";
import {
  isAtPropKeyPosition,
  isInsideComputedKey,
  resolveEffectiveClass,
} from "./completion";
import { WorkspaceIndex } from "./workspaceIndex";

// ============================================================================
// Luix snippets — context-aware completion items
// ============================================================================
//
// These used to live in `snippets/luix.code-snippets` as static VS Code
// snippets. Static snippets have no context awareness: VS Code's fuzzy
// matcher fires them anywhere their prefix's chars appear, so typing
// `Fra` inside a string surfaced every `*Frame` snippet, typing `r`
// inside a string surfaced `reactEvent` / `rfc` / `useRef`, and typing
// `eFra` at a prop-key slot offered to expand into a full
// createElement call. Migrated to dynamic completions so we can gate
// by code mask + prop-key position + enabled frameworks.
//
// Gates applied per `kind`:
//
//   - `element` — Full gating. Suppressed inside strings, at prop-key
//     positions (unless Vide inline-children context), and when the
//     snippet's framework isn't in `luix.frameworks`.
//   - `hook` / `scaffold` / `event` — Suppressed inside strings; only
//     surfaced when React or Roact is in `luix.frameworks` (they're
//     React-specific patterns).
//   - `expr` — Suppressed inside strings only; framework-agnostic.

type SnippetKind =
  | "element"
  | "hook"
  | "scaffold"
  | "event"
  | "expr"
  | "computed";

interface LuixSnippet {
  /** Trigger prefix shown as the completion label. */
  prefix: string;
  /** What kind of snippet this is — drives the gating logic. */
  kind: SnippetKind;
  /** Framework whose factory the snippet expands to. Required for
   *  `kind: "element"`, ignored for the others (which use framework
   *  buckets internally). */
  framework?: FrameworkId;
  /** Snippet body (joined with `\n`). */
  body: string[];
  /** Hover description. */
  description: string;
}

const SNIPPETS: LuixSnippet[] = [
  // ---- React / Roact (parens form) ----
  {
    prefix: "eFrame",
    kind: "element",
    framework: "react",
    description: "Frame element with children slot",
    body: [
      'e("Frame", {',
      "\tSize = UDim2.fromScale(${1:1}, ${2:1}),",
      "\tBackgroundTransparency = ${3:1},",
      "\t$4",
      "}, {",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eScrollingFrame",
    kind: "element",
    framework: "react",
    description: "ScrollingFrame element",
    body: [
      'e("ScrollingFrame", {',
      "\tSize = UDim2.fromScale(1, 1),",
      "\tBackgroundTransparency = 1,",
      "\tScrollBarThickness = ${1:6},",
      "\tCanvasSize = UDim2.new(${2:0, 0, 0, 0}),",
      "\t$3",
      "}, {",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eTextLabel",
    kind: "element",
    framework: "react",
    description: "TextLabel element",
    body: [
      'e("TextLabel", {',
      '\tText = "${1:Hello}",',
      "\tTextColor3 = Color3.fromRGB(${2:255}, ${3:255}, ${4:255}),",
      "\tTextSize = ${5:18},",
      "\tBackgroundTransparency = 1,",
      "\tSize = UDim2.fromScale(1, 0),",
      "\tAutomaticSize = Enum.AutomaticSize.Y,",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eTextButton",
    kind: "element",
    framework: "react",
    description: "TextButton with Activated handler",
    body: [
      'e("TextButton", {',
      '\tText = "${1:Click me}",',
      "\tTextColor3 = Color3.fromRGB(${2:255}, ${3:255}, ${4:255}),",
      "\tTextSize = ${5:18},",
      "\tBackgroundTransparency = ${6:0},",
      "\tSize = UDim2.fromOffset(${7:120}, ${8:40}),",
      "\tAutoButtonColor = ${9:true},",
      "\t[React.Event.Activated] = function()",
      "\t\t$0",
      "\tend,",
      "})",
    ],
  },
  {
    prefix: "eImageLabel",
    kind: "element",
    framework: "react",
    description: "ImageLabel element",
    body: [
      'e("ImageLabel", {',
      '\tImage = "${1:rbxassetid://0}",',
      "\tBackgroundTransparency = 1,",
      "\tSize = UDim2.fromScale(1, 1),",
      "\tScaleType = Enum.ScaleType.Fit,",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eImageButton",
    kind: "element",
    framework: "react",
    description: "ImageButton with Activated handler",
    body: [
      'e("ImageButton", {',
      '\tImage = "${1:rbxassetid://0}",',
      "\tBackgroundTransparency = 1,",
      "\tSize = UDim2.fromScale(1, 1),",
      "\tScaleType = Enum.ScaleType.Fit,",
      "\tAutoButtonColor = false,",
      "\t[React.Event.Activated] = function()",
      "\t\t$0",
      "\tend,",
      "})",
    ],
  },
  {
    prefix: "eUIListLayout",
    kind: "element",
    framework: "react",
    description: "UIListLayout",
    body: [
      'e("UIListLayout", {',
      "\tFillDirection = Enum.FillDirection.${1|Vertical,Horizontal|},",
      "\tHorizontalAlignment = Enum.HorizontalAlignment.${2|Left,Center,Right|},",
      "\tVerticalAlignment = Enum.VerticalAlignment.${3|Top,Center,Bottom|},",
      "\tSortOrder = Enum.SortOrder.LayoutOrder,",
      "\tPadding = UDim.new(0, ${4:8}),",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eUIGridLayout",
    kind: "element",
    framework: "react",
    description: "UIGridLayout",
    body: [
      'e("UIGridLayout", {',
      "\tCellSize = UDim2.fromOffset(${1:100}, ${2:100}),",
      "\tCellPadding = UDim2.fromOffset(${3:8}, ${4:8}),",
      "\tHorizontalAlignment = Enum.HorizontalAlignment.Left,",
      "\tSortOrder = Enum.SortOrder.LayoutOrder,",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eUIPadding",
    kind: "element",
    framework: "react",
    description: "UIPadding (all sides)",
    body: [
      'e("UIPadding", {',
      "\tPaddingTop = UDim.new(0, ${1:8}),",
      "\tPaddingBottom = UDim.new(0, ${2:8}),",
      "\tPaddingLeft = UDim.new(0, ${3:8}),",
      "\tPaddingRight = UDim.new(0, ${4:8}),",
      "\t$0",
      "})",
    ],
  },
  {
    prefix: "eUICorner",
    kind: "element",
    framework: "react",
    description: "UICorner",
    body: ['e("UICorner", {', "\tCornerRadius = UDim.new(0, ${1:8}),", "})$0"],
  },
  {
    prefix: "eUIStroke",
    kind: "element",
    framework: "react",
    description: "UIStroke",
    body: [
      'e("UIStroke", {',
      "\tColor = Color3.fromRGB(${1:255}, ${2:255}, ${3:255}),",
      "\tThickness = ${4:1},",
      "\tApplyStrokeMode = Enum.ApplyStrokeMode.Contextual,",
      "\t$0",
      "})",
    ],
  },

  // ---- Fusion (curried form, table-key children) ----
  {
    prefix: "nFrame",
    kind: "element",
    framework: "fusion",
    description: "Fusion Frame element with [Children]",
    body: [
      'New "Frame" {',
      "\tSize = UDim2.fromScale(${1:1}, ${2:1}),",
      "\tBackgroundTransparency = ${3:1},",
      "\t$4",
      "\t[Children] = {",
      "\t\t$0",
      "\t},",
      "}",
    ],
  },
  {
    prefix: "nTextLabel",
    kind: "element",
    framework: "fusion",
    description: "Fusion TextLabel",
    body: [
      'New "TextLabel" {',
      '\tText = "${1:Hello}",',
      "\tTextColor3 = Color3.fromRGB(${2:255}, ${3:255}, ${4:255}),",
      "\tTextSize = ${5:18},",
      "\tBackgroundTransparency = 1,",
      "\tSize = UDim2.fromScale(1, 0),",
      "\tAutomaticSize = Enum.AutomaticSize.Y,",
      "\t$0",
      "}",
    ],
  },
  {
    prefix: "nTextButton",
    kind: "element",
    framework: "fusion",
    description: 'Fusion TextButton with [OnEvent "Activated"]',
    body: [
      'New "TextButton" {',
      '\tText = "${1:Click me}",',
      "\tSize = UDim2.fromOffset(${2:120}, ${3:40}),",
      "\tBackgroundColor3 = Color3.fromRGB(${4:80}, ${5:80}, ${6:80}),",
      "\tAutoButtonColor = true,",
      '\t[OnEvent "Activated"] = function()',
      "\t\t$0",
      "\tend,",
      "}",
    ],
  },

  // ---- Vide (curried form, inline children) ----
  {
    prefix: "cFrame",
    kind: "element",
    framework: "vide",
    description: "Vide Frame element (inline children)",
    body: [
      'create "Frame" {',
      "\tSize = UDim2.fromScale(${1:1}, ${2:1}),",
      "\tBackgroundTransparency = ${3:1},",
      "\t$4",
      "\t$0",
      "}",
    ],
  },
  {
    prefix: "cTextLabel",
    kind: "element",
    framework: "vide",
    description: "Vide TextLabel",
    body: [
      'create "TextLabel" {',
      '\tText = "${1:Hello}",',
      "\tTextColor3 = Color3.fromRGB(${2:255}, ${3:255}, ${4:255}),",
      "\tTextSize = ${5:18},",
      "\tBackgroundTransparency = 1,",
      "\tSize = UDim2.fromScale(1, 0),",
      "\tAutomaticSize = Enum.AutomaticSize.Y,",
      "\t$0",
      "}",
    ],
  },
  {
    prefix: "cTextButton",
    kind: "element",
    framework: "vide",
    description: "Vide TextButton (events as plain props)",
    body: [
      'create "TextButton" {',
      '\tText = "${1:Click me}",',
      "\tSize = UDim2.fromOffset(${2:120}, ${3:40}),",
      "\tBackgroundColor3 = Color3.fromRGB(${4:80}, ${5:80}, ${6:80}),",
      "\tAutoButtonColor = true,",
      "\tActivated = function()",
      "\t\t$0",
      "\tend,",
      "}",
    ],
  },

  // ---- React / Roact hooks ----
  {
    prefix: "useState",
    kind: "hook",
    description: "React.useState",
    body: [
      "local ${1:value}, set${1/(.)/${1:/upcase}/} = React.useState(${2:nil})$0",
    ],
  },
  {
    prefix: "useEffect",
    kind: "hook",
    description: "React.useEffect",
    body: ["React.useEffect(function()", "\t$0", "end, { $1 })"],
  },
  {
    prefix: "useRef",
    kind: "hook",
    description: "React.useRef",
    body: ["local ${1:ref} = React.useRef(${2:nil})$0"],
  },
  {
    prefix: "useMemo",
    kind: "hook",
    description: "React.useMemo",
    body: [
      "local ${1:value} = React.useMemo(function()",
      "\treturn $0",
      "end, { $2 })",
    ],
  },
  {
    prefix: "useCallback",
    kind: "hook",
    description: "React.useCallback",
    body: [
      "local ${1:onCallback} = React.useCallback(function($2)",
      "\t$0",
      "end, { $3 })",
    ],
  },

  // ---- Function component scaffold ----
  {
    prefix: "rfc",
    kind: "scaffold",
    description: "React-Luau function component scaffold",
    body: [
      "local function ${1:Name}(props): React.ReactNode",
      '\treturn e("${2:Frame}", {',
      "\t\tSize = UDim2.fromScale(1, 1),",
      "\t\tBackgroundTransparency = 1,",
      "\t\t$3",
      "\t}, {",
      "\t\t$0",
      "\t})",
      "end",
      "",
      "return $1",
    ],
  },

  // ---- React.Event handler shorthand ----
  {
    prefix: "reactEvent",
    kind: "event",
    description: "React.Event handler entry",
    body: [
      "[React.Event.${1|Activated,MouseEnter,MouseLeave,MouseButton1Click,InputBegan,InputEnded|}] = function(${2:rbx})",
      "\t$0",
      "end,",
    ],
  },

  // Computed-key starters (`React.Event.X` / `React.Change.X` inside
  // `[…]`) are generated *dynamically* in the provider so the choice
  // list reflects the actual element's events / properties — see the
  // `inComputed` branch in `provideCompletionItems`.

  // ---- Framework-agnostic expressions ----
  {
    prefix: "cfangles",
    kind: "expr",
    description:
      "Rotation-only CFrame, Euler angles in degrees (wrapped in math.rad)",
    body: [
      "CFrame.Angles(math.rad(${1:0}), math.rad(${2:0}), math.rad(${3:0}))$0",
    ],
  },
  {
    prefix: "cfanglesrad",
    kind: "expr",
    description: "Rotation-only CFrame, Euler angles in radians",
    body: ["CFrame.Angles(${1:0}, ${2:0}, ${3:0})$0"],
  },
];

export class ElementSnippetCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(private readonly workspaceIndex: WorkspaceIndex) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // (1) Gate: not inside a string literal. Applies to every snippet
    // kind — `useEffect`, `cfangles`, `eFrame`, etc. — because none of
    // them are valid inside a Lua string. The code mask flags string
    // interiors as false; the partial's last char is at offset-1.
    if (offset > 0) {
      const mask = buildCodeMask(text);
      if (mask[offset - 1] === false) return undefined;
    }

    // (1b) Computed-key context split. Inside an unclosed `[…]` we
    // *only* fire the `computed` kind (which scaffolds the inner
    // expression, e.g. `React.Event.Activated`); every other kind
    // would either nest its own `[…]` (`reactEvent`) or land inside a
    // key expression rather than at a fresh slot (`eFrame`, hooks).
    // Outside `[…]`, we fire everything except `computed`.
    const inComputed = isInsideComputedKey(document, position);

    // Walk back to find the partial identifier under the cursor.
    let identStart = offset;
    while (identStart > 0 && /[A-Za-z0-9_]/.test(text[identStart - 1])) {
      identStart--;
    }
    if (identStart === offset) return undefined;
    const partial = text.slice(identStart, offset);

    // Skip member-access tails — `obj.eFrame` / `self:useState` should
    // not surface the snippets.
    if (identStart > 0) {
      const ch = text[identStart - 1];
      if (ch === "." || ch === ":") return undefined;
    }

    // Enclosing-call + prop-key-position lookups — used only by
    // `element` snippets. Computed once and shared.
    const aliases = getAliasPartition();
    const enclosing = findEnclosingPropsCall(
      text,
      offset,
      aliases,
      this.workspaceIndex.knownDirectCallTargets()
    );
    const atKey = enclosing
      ? isAtPropKeyPosition(document, position)
      : false;
    const enclosingFw =
      enclosing && enclosing.alias
        ? findFrameworkForAlias(enclosing.alias)
        : undefined;

    // Enabled-frameworks set, mapping Roact users into the React
    // bucket since they share the `e(...)` / `useX` call shape.
    const enabledIds = new Set(getEnabledFrameworks().map((f) => f.id));
    if (enabledIds.has("roact")) enabledIds.add("react");
    const hasReactish = enabledIds.has("react");

    const wordRange = new vscode.Range(
      document.positionAt(identStart),
      position
    );
    const lowerPartial = partial.toLowerCase();
    const out: vscode.CompletionItem[] = [];
    let idx = 0;

    // ---- Inside `[…]` — dynamic React.Event / React.Change starters ----
    //
    // Build the choice list from the *actual element*'s events and
    // properties (resolved through `resolveEffectiveClass`, which also
    // handles user-defined components via `---@extends ClassName` /
    // detected-base inference). Falls back to GuiObject for unknown
    // classes so the snippet still does something useful.
    if (inComputed && hasReactish && enclosing) {
      const baseClass = await resolveEffectiveClass(
        enclosing.className,
        document,
        this.workspaceIndex
      );
      const resolved = baseClass ?? "GuiObject";
      const events = flattenClassEvents(resolved);
      const props = flattenClassProps(resolved);
      const eventChoices = events.length > 0 ? events : ["Activated"];
      // VS Code's `${…|choice|}` snippet syntax doesn't tolerate `,`,
      // `}` or `|` inside option names; class events / props never
      // contain those, but escape defensively in case future data
      // includes weird entries.
      const eventList = eventChoices.map(escapeChoice).join(",");
      const propList = (props.length > 0 ? props : ["Property"])
        .map(escapeChoice)
        .join(",");
      const eventItem = makeComputedItem(
        "React.Event",
        `React.Event handler key — ${resolved} (${eventChoices.length} events)`,
        `React.Event.\${1|${eventList}|}$0`,
        wordRange,
        idx++
      );
      const changeItem = makeComputedItem(
        "React.Change",
        `React.Change listener key — ${resolved} (${props.length} props)`,
        `React.Change.\${1|${propList}|}$0`,
        wordRange,
        idx++
      );
      // Prefix filter — only surface when the user's partial matches
      // one of the labels (case-insensitive). Keeps the dropdown
      // quiet when the user is typing something else entirely.
      if ("React.Event".toLowerCase().startsWith(lowerPartial)) {
        out.push(eventItem);
      }
      if ("React.Change".toLowerCase().startsWith(lowerPartial)) {
        out.push(changeItem);
      }
      // Fall through so the static loop below can still contribute
      // (it'll skip every `kind !== "computed"` entry inside `[…]`,
      // and the static SNIPPETS array no longer has `computed`
      // entries, so this is effectively a no-op — but kept for
      // symmetry if computed-kind statics ever come back).
    }

    for (const snip of SNIPPETS) {
      // Per-kind framework gating + prop-key + computed-key
      // suppression. Computed-context split is enforced first so the
      // existing switch only sees the relevant kinds.
      if (inComputed && snip.kind !== "computed") continue;
      if (!inComputed && snip.kind === "computed") continue;

      let allowed: boolean;
      switch (snip.kind) {
        case "element": {
          // Framework must be enabled.
          if (!snip.framework || !enabledIds.has(snip.framework)) {
            allowed = false;
            break;
          }
          // Prop-key position: only OK when the parent supports inline
          // children (Vide). Otherwise we'd offer a snippet that would
          // brick the table when accepted.
          if (
            enclosing &&
            atKey &&
            (!enclosingFw || enclosingFw.childrenLayout !== "inline")
          ) {
            allowed = false;
            break;
          }
          allowed = true;
          break;
        }
        case "hook":
        case "scaffold":
        case "event":
          // React / Roact patterns. Only show when one of those
          // frameworks is enabled. No prop-key suppression — these
          // are unlikely to fire there anyway (prefixes don't match
          // common prop names) and `reactEvent` is *meant* to be
          // typed inside a props table.
          allowed = hasReactish;
          break;
        case "expr":
          // Framework-agnostic value expressions (`cfangles*`).
          // Already protected from string context by the gate above;
          // no further restriction.
          allowed = true;
          break;
        case "computed":
          // Inside `[…]` starter shapes — `React.Event.X`,
          // `React.Change.X`. Only meaningful in React / Roact files
          // since they're React-specific keys. Already gated to
          // `inComputed === true` above, so we just check framework.
          allowed = hasReactish;
          break;
      }
      if (!allowed) continue;
      if (!snip.prefix.toLowerCase().startsWith(lowerPartial)) continue;
      const item = new vscode.CompletionItem(
        snip.prefix,
        vscode.CompletionItemKind.Snippet
      );
      item.detail = snip.description;
      item.filterText = snip.prefix;
      // Sort under luau-lsp's word matches but above the long
      // alphabetical tail. Preserves the static-snippet ranking so
      // muscle memory still works.
      item.sortText = `08_${String(idx).padStart(4, "0")}`;
      item.range = wordRange;
      item.insertText = new vscode.SnippetString(snip.body.join("\n"));
      out.push(item);
      idx++;
    }
    return out;
  }
}

/**
 * Build a Luix completion item for a dynamic computed-key snippet
 * (`React.Event.<choice>` / `React.Change.<choice>`). The body is
 * generated from the resolved class's events / props so the choice
 * list reflects what's actually available on the element.
 */
function makeComputedItem(
  label: string,
  detail: string,
  body: string,
  range: vscode.Range,
  idx: number
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    label,
    vscode.CompletionItemKind.Snippet
  );
  item.detail = detail;
  item.filterText = label;
  item.sortText = `07_${String(idx).padStart(4, "0")}`;
  item.range = range;
  item.insertText = new vscode.SnippetString(body);
  return item;
}

/** Escape a choice-list entry so the `${1|...|}` snippet syntax
 *  doesn't get confused by `,`, `|`, or `}` inside an event / prop
 *  name. Class data shouldn't contain those, but a `.replace` here
 *  is cheap insurance against future additions. */
function escapeChoice(name: string): string {
  return name.replace(/[,|}\\]/g, (c) => "\\" + c);
}
