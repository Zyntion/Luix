# Change Log

All notable changes to **Luix** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0]

### Anchor preset completion

Inside any props table, type `anchor:` and pick one of nine presets —
`tl`, `t`, `tr`, `l`, `c`, `r`, `bl`, `b`, `br`. Accepting `anchor:br`
expands to:

```lua
AnchorPoint = Vector2.new(1, 1),
Position = UDim2.fromScale(1, 1),
```

Kills the constant AnchorPoint mental math.

### AnchorPoint auto-detect

When `Position` uses `UDim2.fromScale(0.5, …)` / `UDim2.new(1, 0, 1, 0)`
/ similar *without* a matching `AnchorPoint`, you get an Information-
level diagnostic with a *Add `AnchorPoint = Vector2.new(0.5, 0.5)`*
quick-fix that inserts the correct AnchorPoint at the right indentation.

### Wrap-in code actions

Cursor in any element call → lightbulb offers *Wrap in Frame* / *Wrap
in ScrollingFrame* / *Wrap in Frame + UIListLayout*. Framework-aware —
parens form for React/Roact, curried form (with `[Children] = { … }`)
for Fusion, inline children for Vide.

### UDim2 form conversion

Mirror of the Color3 convert action — cursor on any
`UDim2.new(…)` / `UDim2.fromOffset(…)` / `UDim2.fromScale(…)` →
lightbulb offers conversions between the three forms, but only when
the value is actually expressible in the target form (e.g. only offers
`fromOffset` if all scales are 0).

### Image-asset thumbnail in hover

Hover any string of the form `"rbxassetid://NNNN"` (Image prop, Icon
prop, anywhere) to see the actual asset image fetched from Roblox's
CDN via `thumbnails.roblox.com`. Cached per session. Catches "did I
paste the right ID?" bugs before you reload Studio.

### Image-asset gutter previews (opt-in)

Every `"rbxassetid://NNNN"` reference can also get a tiny thumbnail in
the gutter next to its line. Downloads once per asset and persists so
reopens are instant.

- **`luix.imageGutter.enabled`** (default `false`) — toggle the
  feature. The hover preview always works either way.
- **`luix.imageGutter.cacheLocation`** (default `"global"`) — either
  VS Code's extension storage or `.luix/assetThumbs/` inside the
  workspace (with `.luix/.gitignore` auto-written).
- The Luix sidebar shows a one-click **Enable image gutter previews**
  entry while the feature is off so it stays discoverable.
- Once enabled, sidebar surfaces **Purge image preview cache**
  (`N assets — X MB` readout) and **Open image cache folder**.
- Purge wipes both global and workspace cache locations so flipping
  `cacheLocation` mid-project never strands stale files.

### Extract-to-component refactor

Right-click any element call → **Luix: Extract to component…** Prompts
for a name, writes a new `.luau` file alongside the source with just
the imports the extracted code actually uses, and rewrites the call
site to invoke the new component. Imports are pulled transitively so
common patterns like `local e = React.createElement` correctly bring
`React` along too. Framework-aware — emits `e(NewComp, {})` for
React/Roact and `NewComp {}` for Fusion/Vide (which compose components
by direct call rather than via the `New`/`create` keyword).

### Custom-component hover

Hovering the class slot of `e(MyButton, …)` / `New "MyButton" {…}` /
`create "MyButton" {…}` surfaces a tooltip with the component's
inferred props, base class, and `---@extends` chain. Hovering a prop
key inside the call shows whether the prop is component-defined or
forwarded from the base class.

### Color3 picker now recognises `fromHex` and `fromHSV`

The colour swatch + picker fires on all four Color3 constructors —
`fromRGB`, `new`, `fromHex`, `fromHSV`. The picker presentation order
puts your existing notation first so editing visually never silently
flips your codebase from hex to RGB or vice versa.

### Convert Color3 between formats

Cursor on any Color3 literal → lightbulb offers *Convert to
`Color3.fromRGB(...)` / `fromHex(...)` / `new(...)` / `fromHSV(...)`*.
Resolves the actual colour and rewrites the constructor.

### Reference CodeLens

Every component definition gets a `▸ N references` CodeLens above it.
Click to peek every workspace call site of `e(MyButton, …)`. Toggle
via **`luix.componentReferencesLens.enabled`**.

## [1.1.1]

### RichText colour picker

VS Code's inline colour swatch + picker now fires on
`color="#FF0000"` and `color="rgb(255, 0, 0)"` values inside `<font>`,
`<stroke>`, and `<mark>` tags — both forms parse, and editing via the
picker preserves whichever form you originally wrote (no surprise
hex↔rgb conversions). Gated by the new **`luix.richText.colorPicker`**
(default `true`) so users who disable Luix's Color3 picker
(`luix.colorPreview.enabled`) for extension-conflict reasons can still
keep the RichText one.

### Format settings for default colour placeholders

- **`luix.color3.defaultFormat`** (default `"fromRGB"`) — pick the
  constructor Luix inserts when accepting a `BackgroundColor3` /
  `TextColor3` / etc. completion. Enum: `fromRGB`, `fromHex`, `new`,
  `fromHSV`.
- **`luix.richText.defaultColorFormat`** (default `"hex"`) — controls
  the `<font color="…">` / `<stroke color="…">` / `<mark color="…">`
  placeholder form. Enum: `hex`, `rgb`.

Two separate settings because Color3 has four constructors while
RichText only supports two formats.

### Missing-RichText warning

If a props table sets `Text = "…<font…>…"` (or any other RichText tag)
but doesn't also set `RichText = true`, Roblox renders the tags as
literal characters. Luix now flags this with a Warning on the `Text`
key and offers a *Set `RichText = true`* quick-fix that inserts the
line right above. Only fires on string-literal Text values — `Text =
someVar` stays silent because we can't see inside.

## [1.1.0]

### RichText tag completion + auto-close

Typing `<` inside a single-line string surfaces Roblox's RichText tags
(`<b>`, `<i>`, `<u>`, `<s>`, `<sc>`, `<smallcaps>`, `<uppercase>`,
`<sub>`, `<sup>`, `<comment>`, `<br/>`, `<font …>`, `<stroke …>`,
`<mark …>`). The accepted snippet includes the matching close tag with
the cursor placed inside, so picking `<font>` gives you
`<font color="…">|</font>` in one keystroke.

Inside an open `<font …>`, `<stroke …>`, or `<mark …>`, attribute-name
completion fires so multiple attributes can be combined the way Roblox
allows — `<font color="#FF0000" size="18" weight="Bold">`. Picking
`<font>` parks a tab stop right before the `>` so the user can type a
space, get the next attribute suggested, and chain as many as needed
before tabbing into the tag body.

Finishing an opening tag manually — typing the `>` of `<font size="18">`
— inserts the matching `</font>` after the cursor. Triggers only for
known RichText tag names, so unrelated `<` / `>` in code are left alone.

Inner attribute quotes adapt to the outer Lua string's quote
(`Text = "<font color='#FF0000'>..."`,
`Text = '<font color="#FF0000">...'`, or Luau backtick template strings
`` Text = `<font color="#FF0000">...` ``) so attribute values never need
backslash escaping.

Gated by **`luix.richText.enabled`** (default `true`).

### Prop validation diagnostics

Four new bug-catching diagnostics under a single
**`luix.propValidation.enabled`** flag (default `true`):

- **Unknown property** on a known Roblox class — `e("Frame", {
  ScrollingDirection = … })` warns "Unknown property `ScrollingDirection`
  on `Frame`. Did you mean `Position`?" with a *Rename to `Position`*
  quick-fix.
- **Duplicate key** in the same props table — `Size = …, Size = …`
  warns that the second assignment silently overwrites the first.
- **Wrong enum type** — `BorderMode = Enum.Font.X` warns because
  `BorderMode` expects `Enum.BorderMode`.
- **Overridden by component** — when a custom component's root element
  hardcodes a prop (`Position = UDim2.new(0,0,0,0)` rather than
  `Position = props.Position`), passing that same prop at the call site
  surfaces an Information-level "won't be overridden" hint. Detection
  is purely textual on the component's `props` parameter, so the hint
  errs on the side of silence — only flags clear cases where the root
  element makes no reference to `props` for that key.

### Roblox private-use-area glyph support

Roblox's icon set (Robux `U+E002`, Premium `U+E001`, Verified `U+E000`,
Roblox Plus `U+E003`) lives in the Unicode private-use area, which means
VS Code's default fonts render them as `[]` boxes. Luix now:

- Annotates each occurrence with an inlay-hint label so you can tell
  which glyph is which while reading code.
- Provides a hover with the name, codepoint, and Luau `\u{…}` escape.
- Lets you insert the literal glyph from inside a string by typing
  `:robux:`, `:premium:`, `:verified:`, or `:roblox-plus:`.

Gated by **`luix.robloxGlyphs.enabled`** (default `true`).

User-defined shortcuts go in **`luix.robloxGlyphs.custom`** (empty by
default) — a `slug → string` map. Example: setting `{ "gbp": "£" }`
makes `:gbp:` insert `£` from inside a string. Useful for any character
your keyboard can't reach. Built-in slugs can't be shadowed.

### Class-name completion in factory calls

Typing `e("Fr|"`, `Roact.createElement("Fr|"`, `New "Fr|"`,
`create "Fr|"`, or the Luau backtick form `` e(`Fr|`) `` now surfaces
Roblox class names. Accepting inserts the class name *and*, if the call
doesn't already have a props table, adds the `, { … }` block with the
cursor placed inside. Works for all four enabled frameworks.

### Misc

- Props completion now also opens on `{` so common props (`Name`,
  `Size`, …) appear the instant you type the props brace.
- Ships a `configurationDefaults` setting that turns on
  `editor.quickSuggestions.strings` for `lua` / `luau` files, so
  class-name and RichText suggestions filter live as you type inside a
  string literal.
- The legacy `reactLuauPropsHelper.*` migration notification that fired
  every VS Code startup has been removed. Legacy keys are still read as
  a silent fallback so nothing breaks, but the prompt is gone. The
  matching `luix.suppressLegacySettingsWarning` setting has been removed
  too — if you had it set, you can delete the orphaned line from your
  `settings.json`.
- `npm run package` produces the `.vsix`.

## [1.0.0]

Initial release.

### Multi-framework prop completion

- **React-Luau** — `e("Frame", { … })`, `React.createElement(...)`.
- **Roact** — `Roact.createElement("Frame", { … })`.
- **Fusion** — `New "Frame" { … }`, `Fusion.New "Frame" { … }`.
- **Vide** — `create "Frame" { … }`, `vide.create "Frame" { … }`.

For each, Luix offers context-aware property completion with type-aware
value snippets (`BackgroundColor3 = Color3.fromRGB(255, 255, 255),` and
similar for `UDim2`, `Vector2`, `Font`, booleans, enums, …).

### In-file & cross-file inference for custom components

Components defined as `local function MyCard(props) … end` get prop
suggestions inferred from four signals:

1. **Auto-detection** from the return statement (`return e("Frame", …)`,
   `return New "Frame" { … }`, etc).
2. **`---@extends ClassName` and `---@prop NAME [type]` annotations**
   above the function definition.
3. **Typed `props` parameter** — inline literal type or same-file `type`
   alias.
4. **`luix.props`** central config for components that live outside the
   workspace or need a global override.

The workspace is indexed at activation and kept fresh via the file
watcher and live document-change events, so the lookup works whether
you're editing the component itself or a file that `require`s it.

### Sidebar (Activity Bar)

- **Workspace view** — one-click access to the chores every Roblox UI
  dev runs constantly:
  - Regenerate Wally types (runs `wally install` → `rojo sourcemap` →
    `wally-package-types` as a chained command in a reusable named
    terminal). Visible when `wally.toml` is detected.
  - `wally install`.
  - Generate Rojo sourcemap. Visible when a `*.project.json` is
    detected.
  - New component scaffolds: React, Fusion, or Vide. Prompts for a
    name, writes the file next to the active editor, opens it.
- **Components view** — every component the workspace indexes,
  alphabetised. Each row shows the source file and the class it extends.
  Click to jump straight to the definition.

### Color palette

- New setting `luix.palette` — define named project colours. They
  appear as completions when you type `Color3.`. Accepting one replaces
  the prefix with the full configured `Color3.fromRGB(...)` expression,
  so you get design-token consistency without sacrificing greppability.

### Editor integrations

- **Outline + breadcrumbs** that mirror the React tree of the current
  document.
- **Inlay hints** at the closing `})` / `}` of every multi-line element,
  showing the class name (and `Name` prop when present). Defaults to
  "ancestors-only" mode so the file stays clean; the labels surface only
  on the chain containing the cursor.
- **Color preview.** `Color3.fromRGB(...)` and `Color3.new(...)` get a
  swatch in the gutter plus VS Code's colour picker.
- **Hover docs.** Hovering any prop inside an element table shows the
  type, the class it's introduced on, and a deep link to the Roblox
  reference page.
- **`[React.Event.X]` / `[React.Change.X]` completion.** Inside event
  bracket syntax, the suggestion list switches to the available events
  / observable properties for the enclosing class.
- **Annotation completion** for `---@extends ` (class names) and
  `---@prop NAME ` (Roblox/Luau types).
- **Snippet library** — `eFrame` / `nFrame` / `cFrame` (React / Fusion
  / Vide), `eTextLabel` / `nTextLabel` / `cTextLabel`, button variants,
  `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `rfc`
  (function component scaffold), and more.

### Diagnostics + quick fixes

- **Deprecation warnings** (default on): `Font = Enum.Font.X` → `FontFace
  = Font.fromName(...)` quick-fix; `TextColor = …` → rename to
  `TextColor3`. Toggle with `luix.deprecationDiagnostics`.
- **Reserved-name warning** (opt-in via `luix.warnReservedPropNames`):
  flags `---@prop` declarations that shadow a property of the declared
  base class.
- **Auto-import** (opt-in via `luix.autoImport.enabled`): for
  `e(MyComponent, { … })` where the component is in the workspace but
  not yet `require`d locally, surface an Information diagnostic with a
  one-click quick-fix that inserts the require line. Two path styles:
  `relative` (`script.Parent…X` chain) and `alias` (configurable
  filesystem → Roblox prefix mappings).

### Performance

All hot pure functions (mask + masked text, `findAllCreateElementCalls`,
`scanDocument`, `buildAliasAlternation`) are memoised with small LRU
caches so a single keystroke causes at most one parse pass across all
providers. The class hierarchy is flattened lazily and the result cached
permanently.

### Configuration

Toggle frameworks with `luix.frameworks` (default: all). Override
factory aliases per-framework via `luix.<framework>.aliases` for
codebases that locally alias the factory (e.g. `local n = Fusion.New`).
Inlay hint scope, position, and per-provider toggles are all
configurable; see the settings UI under "Luix".
