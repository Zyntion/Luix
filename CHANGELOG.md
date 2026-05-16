# Change Log

All notable changes to **Luix** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

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
