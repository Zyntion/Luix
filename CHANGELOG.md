# Change Log

All notable changes to **Luix** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.4.3]

### `Size` / `Position` completion now hands you the constructor picker

Accepting a UDim2-typed prop (`Size`, `Position`, `CanvasSize`,
`CellSize`, `TileSize`, `PageSize`, `CellPadding`) used to insert the
full `Size = UDim2.new(0, 0, 0, 0),` template with tab stops in each
channel — fine if you wanted `.new`, annoying if you wanted
`.fromScale` or `.fromOffset` (which are at least as common in modern
Vide / React-Luau code), because you had to delete and retype.

Now UDim2 follows the same pattern as `Color3`, `UDim`, and `Font`:
Luix inserts `Size = UDim2.` and immediately opens the suggest
dropdown, so you can pick `.new` / `.fromScale` / `.fromOffset` /
`.fromAxis` (or any spacing token you've defined under
`luix.spacing`). Picking a constructor still inserts its full
per-channel snippet, so the original Tab-through-each-value workflow
is preserved for the cases where you do want `.new`.

### Direct instance-call detection — `Frame({...})` etc. for Vide

Vide lets you construct built-in Roblox UI instances by calling the
class name directly — `Frame({ Size = … })`,
`TextButton({ Activated = … })`, `ScrollingFrame { CanvasSize = … }` —
instead of going through `create "Frame" { … }`. Luix now recognises
these as instance-creation sites and surfaces the matching class's
prop + event completions inside the table.

- **`luix.vide.directInstanceCalls`** (default `true`) — opt-out
  setting in case you have local variables named after Roblox UI
  classes that you call with a table for unrelated reasons. Only
  applies when Vide is in `luix.frameworks` — React-only / Roact-only
  projects are unaffected.
- **Curated allowlist.** Re-uses Luix's existing class hierarchy
  (Frame, ScrollingFrame, TextLabel, TextButton, ImageLabel,
  ImageButton, ScreenGui, BillboardGui, every `UI*` constraint /
  layout / decorator), minus the abstract bases (`Instance`,
  `GuiObject`, `GuiButton`, …). Non-UI Roblox class names (`Camera`,
  `Sound`, `Tween`, `Workspace`, …) are deliberately absent — Luix
  doesn't model them, and they're common local-variable names.
- **Events get merged just like `create "Frame" {…}`.** Direct
  instance calls are attributed to Vide downstream, so `Activated`,
  `MouseEnter`, etc. surface as suggestions on instance classes that
  have them — matching the canonical curried form.
- **Workspace components shadow built-in class names.** If you've
  defined your own `local function Frame(props)` somewhere, _that_
  component's declared props win over Roblox's `Frame`.

### Direct component-call detection for Vide / Fusion

Custom Vide and Fusion components are typically invoked directly with
a props table — `StylizedButton({ Theme = "Green", Text = "..." })` or
the curried `StylizedButton { Theme = "Green", ... }` — rather than
wrapped in a factory call. Luix's parser previously only recognised
the alias-prefixed forms (`e(Comp, { … })`, `create "Frame" { … }`,
`New "Frame" { … }`), so prop completions, hover docs, anchor presets,
and prop-validation diagnostics all silently bailed inside the props
table of a direct component call. luau-lsp's word-based suggestions
then filled the gap with unrelated identifiers (`TextLabel`,
`TextService`, etc.).

- **`findEnclosingPropsCall` now accepts a `directComponents` set.**
  When the cursor is in a `{ … }` table preceded by `<Identifier>(`
  or `<Identifier> ` and the identifier appears in that set, the call
  is treated as a direct component call. The result carries a new
  `isDirectComponentCall: true` flag so callers can branch (e.g.
  skip merging built-in-instance events).
- **`WorkspaceIndex.knownComponentNames()`** exposes a synchronous
  snapshot of every component the index has seen, which is what the
  completion / hover / anchor-preset / diagnostics paths now pass in.
  The set is the entire safety gate — without it the curried regex
  would match every `f { … }` table-call in the language.
- **Method calls and qualified accesses stay quiet.**
  `obj:Card({ … })` and `Mod.Card({ … })` are deliberately excluded
  via the leading char-class so non-UI code can't accidentally
  trigger prop completions.
- **Framework-mediated calls take precedence.** The existing
  parens / curried alias paths run first; the direct-call detection is
  a strict fallback. Mixing styles in one file (`e("Frame", { …
StylizedButton({ … }) … })`) keeps each call's framework attribution
  intact.

9 unit tests added (`Direct component-call detection` suite) covering
the happy path, the safety cases (unknown identifier, no-set
back-compat, method calls, qualified accesses), and the
mixed-framework nesting case.

## [1.4.2]

### Asset thumbnail hover / gutter — false "moderated" after edits

Changing an `rbxassetid://…` value (or hovering one Roblox has just
started thumbnailing) often showed _"Thumbnail unavailable (asset may
be moderated, deleted, or the API is unreachable)"_ for a full minute,
even when the asset was fine — only a window reload would clear it.

- **Stop caching transient API states.** Roblox's thumbnails API
  returns `Pending` / `InReview` while it's still generating the
  image (typical for freshly-referenced assets), and
  `Error` / `TemporarilyUnavailable` during backend hiccups. The
  previous implementation only treated `Completed` as success and
  cached every other state — transient or not — as a failure for
  60 seconds. Now transient states bypass the cache entirely so the
  next hover or gutter refresh retries against the (usually
  now-Completed) response.
- **10 s settled-failure TTL** (was 60 s). Even when a fetch
  genuinely fails — typo'd ID, network blip — fixing it gets a fresh
  fetch on the next interaction instead of stranding the user behind
  a minute-long cache.
- **State-aware hover message.** Instead of always saying _"asset
  may be moderated, deleted, or the API is unreachable"_, the hover
  now reflects the actual API state: _"Roblox is still generating
  the thumbnail — hover again in a few seconds"_ for Pending /
  InReview, _"temporarily unavailable"_ for Error /
  TemporarilyUnavailable, _"asset has been moderated or removed"_
  for Blocked / Moderated.

## [1.4.1]

### Regenerate Wally types — Windows PowerShell + Defender fix

The **Regenerate Wally types** button (and the
`luix.wally.regenerateTypes` command) chained its three steps with
`&&`, which Windows PowerShell 5.1 — the default shell on Windows —
rejects as an invalid statement separator, so the command failed
before `wally install` even started.

- **Shell-aware chaining.** On Windows PowerShell 5.1 the chain
  is now emitted as `cmd1; if ($?) { cmd2; … }`. PowerShell 7+,
  cmd.exe, and POSIX shells continue to use `&&`.
- **300 → 1500 ms breather between `wally install` and
  `rojo sourcemap`.** Windows Defender briefly locks the freshly
  written `Packages/*.lua` link files for real-time scanning. Without
  a pause, rojo's sourcemap silently misses them and
  `wally-package-types` then reports `Linker node 'Packages/X.lua'
not found in sourcemap` for every top-level package. The delay is
  emitted in the active shell's syntax (`Start-Sleep` /
  `timeout /nobreak` / `sleep`).

## [1.4.0]

This release adds three full-fledged visual editors (gradient,
sprite-rect, plus four hover previews), a new diagnostic, and a
sort-props action. Editors are marked **Preview** in the UI so
users know they're still being polished.

### Gradient editor (`luix.gradient.*`)

A single **Edit UIGradient** CodeLens above every
`e("UIGradient", { … })` element opens a combined side-panel editor
with Color, Transparency, and Rotation. Standalone
`ColorSequence.new(...)` and `NumberSequence.new(...)` literals (not
inside a UIGradient) get a focused per-literal editor instead.

- **Colour ramp** — drag triangle stops, click the strip to add,
  per-stop colour picker, hover-indicator pill showing the offset.
- **Transparency curve** — grid canvas with draggable circle stops
  (X = time, Y = value), envelope shading when non-zero.
- **Rotation slider** — −180° to 180°, slider + numeric input.
- **Preview square** — combines colour + transparency + rotation
  and multiplies by the parent element's `BackgroundColor3`
  (Roblox's `UIGradient` semantics), so what you see matches what
  Roblox renders.
- **Output respects `luix.color3.defaultFormat`** for `fromRGB` /
  `fromHex` / `new`. Default `Color = ColorSequence.new(white)`,
  `Transparency = NumberSequence.new(0)`, and `Rotation = 0` are
  _omitted_ from the written-back props block — no noise.
- **Hover previews** — `ColorSequence` shows the gradient strip,
  `NumberSequence` shows the value curve. Toggles:
  `luix.gradient.codeLensEnabled` (on),
  `luix.gradient.previewOnHover` (on).
- **Polish** — `Shift` snaps drag/click to 0.05, hover indicator
  on strip and curve, scroll-wheel + arrow stepping on numeric
  fields, decimal input always renders `.` regardless of locale,
  blur-revert on invalid input.

### Rect editor (`luix.rectEditor.*`)

An **Edit sprite rect** CodeLens appears above every
`e("ImageLabel" | "ImageButton", { … })` whose `Image` prop is a
literal `rbxassetid://…`. Opens a side-panel editor:

- Thumbnail fetched from `thumbnails.roblox.com` at the largest
  available size, with a fallback ladder (768 → 512 → 420 → 256 → 150).
- Draggable rectangle with 8 resize handles; dimmed mask shows
  what gets cropped.
- X / Y / W / H number fields with `Shift` = 10× step.
- **Aspect-ratio auto-detect** — reads a sibling
  `UIAspectRatioConstraint` or a fixed-pixel `Size = UDim2.fromOffset(…)`
  and pre-fills the **Frame aspect** input.
- **Crop preview overlay** — a dashed yellow box inside the
  selection showing exactly what `ScaleType.Crop` will actually
  render given the frame aspect. Hidden for other ScaleTypes.
- **Native dimension auto-detect via Open Cloud** — when
  `luix.openCloud.apiKey` is set (key needs the `legacy-asset:manage`
  permission), the editor hits
  `apis.roblox.com/asset-delivery-api/v1/assetId/{id}`, downloads the
  returned CDN location, and reads the PNG/JPEG header to extract the
  true pixel dimensions. One call per asset, ever — results are
  persisted to `globalState`.
- **Source dimensions fallback** — without an API key (or if the
  lookup fails) the editor uses the thumbnail's natural size and lets
  you type `Source W` / `Source H` manually. Manual values are also
  cached per asset, so the typing cost is one-time.
- **Scroll-to-zoom** — wheel on the canvas zooms (15% – 300%),
  with a discoverable **🔍 zoom bar** (− / % / +) in the corner.
- **Rect can exceed source dimensions** — W and H accept up to 4×
  source; the rect can be dragged past the image edge. Overflow is
  signalled with a dashed amber border.
- **Stripped on the "full image" default** — `ImageRectOffset = (0,0)`
  and `ImageRectSize = (0,0)` are omitted on Apply.

### Unused-prop diagnostic (`luix.unusedProps.enabled`, on by default)

Props declared in a component's parameter type
(`props: { Foo: …, Bar: … }`) or its `@luix-props` annotation that
are never read in the body are flagged with the unused-declaration
grey-out style (`Hint` severity, `Unnecessary` tag — same treatment
TypeScript uses for unused locals).

Skipped automatically when the body forwards `props` wholesale
(`e(Base, props)`, `for k, v in props do`, computed-key indexing)
since static analysis can't determine downstream usage. Squiggle
lands on the field name inside the type annotation when possible,
otherwise on the function definition line.

### Visual hover previews (`luix.hoverPreviews.enabled`, on by default)

Inline SVG previews rendered straight from your literal values —
no network requests, no caching:

- **`TweenInfo.new(...)`** — 240×140 graph of the easing curve.
  All 12 `EasingStyle` × 4 `EasingDirection` combinations are
  implemented as math functions. Below the curve: duration,
  repeat-count, reverses, and delay summary.
- **`e("UIPadding", { … })`** — box visualisation with the inner
  content area indented by the configured `PaddingTop` / `Right` /
  `Bottom` / `Left`. Each non-zero side gets its pixel value labeled.
- **`e("UICorner", { … })`** — rounded rectangle rendered at the
  configured `CornerRadius`.
- **`e("UIStroke", { … })`** — sample box with the stroke applied
  at the configured `Thickness` / `Color` / `Transparency`.

### Sort props by category (`luix.sortProps.*`)

- **Code action** — Right-click anywhere inside a props table → 💡
  **Sort props by category**. Reorders props by category (then by
  canonical order within each category, stable on ties).
- **Format-on-save** — `luix.sortProps.onSave` (default `false`).
  When enabled, every props table in the document is sorted on
  save. Off by default so saving a teammate's file doesn't
  reshape their layout.
- **Configurable order** — `luix.sortProps.categoryOrder` (string
  array) lets you reorder _or remove_ categories. Defaults:
  Identification → Layout → Style → Visibility → Image → Text →
  Behavior → Events → Refs → Children → Other.
- **Computed-key aware** — captures `[React.Event.Activated]`,
  `[OnEvent "…"]`, `[Children]`, etc. Vide-style plain identifier
  events (`Activated = function() … end`) are recognised too.
- **Comment-safe** — tables containing `--` comments are skipped
  so comments never get detached. Idempotent: re-sorting a sorted
  table is a no-op (no spurious save edits).

### Per-class prop type overrides

Some Roblox prop names mean different things on different classes
(e.g. `Frame.Style → Enum.FrameStyle`, but
`GuiButton.Style → Enum.ButtonStyle`). 1.3.0's global `PROP_TYPES`
map could only hold one value per prop name and silently picked
the wrong enum on Frame.

New `PROP_TYPE_OVERRIDES` map keyed by class, plus a
`getPropType(className, propName)` helper that walks the class
hierarchy. The hover tooltip, completion value-snippet, and the
wrong-enum diagnostic now all resolve `Style` (and any future
conflicts) per-class. Adding more is a one-line entry per class.

### Wrap-in code action — fixes (regressions from 1.3.0)

- **Multi-element selection** — selecting `UIPadding + TextLabel`
  now wraps _those two siblings_ in a new container, instead of
  wrapping their parent `Frame` (the previous behaviour found the
  smallest call containing the selection, which is always the
  parent for multi-element selections).
- **Indentation** — wrapped lines no longer get double-indented.
  The previous `indentLines(text, baseIndent + step)` prepended
  both the base AND the new step to lines that already had their
  original indent baked in, producing 4-tab-deep `Name = …` etc.

### Expanded class & prop catalogue ([src/data.ts](src/data.ts))

Built-in `classHierarchy` and `PROP_TYPES` significantly expanded
to track newer Roblox additions and previously-missing props:

- **GuiBase2d** — `RootLocalizationTable`, `SelectionBehaviorDown/Left/Right/Up`, `SelectionGroup`, `SelectionChanged` event.
- **GuiObject** — `InputSink`, `NextSelection*`, `SelectionImageObject`.
- **GuiButton** — `HoverHapticEffect`, `PressHapticEffect`, `Style`.
- **Frame** — `Style`.
- **VideoFrame** — `MaximumResolution`, `RollOffMaxDistance/MinDistance/Mode`.
- **TextLabel / TextButton** — `OpenTypeFeatures`.
- **TextBox** — re-rooted under `GuiObject` (was `TextLabel`) to
  match Roblox's actual hierarchy; full text-prop set mirrored.
- **BillboardGui** — `Adornee`, `ResetOnSpawn`, `TabKeyboardNavigation`.
- **SurfaceGui** — `Active`, `TabKeyboardNavigation`.
- **ScreenGui** — `TabKeyboardNavigation`.
- **UIStroke** — `BorderOffset`, `BorderStrokePosition`, `StrokeSizingMode`, `ZIndex`.
- **Instance** — `Archivable`.
- And 40+ new `PROP_TYPES` entries for the above, covering
  `Rect`, `Camera`, `Player`, `LocalizationTable`, plus several
  new enum types (`BorderStrokePosition`, `HapticEffect`,
  `InputSink`, `NormalId`, `RollOffMode`, `SelectionBehavior`,
  `StrokeSizingMode`, `VideoSampleSize`).

## [1.3.0]

### New diagnostics (gated by `luix.propValidation.enabled`, on by default)

- **Numeric-range warnings** — `Transparency = 1.5`, `Rotation = 720`,
  `BorderSizePixel = 100`, etc. Per-prop bounds.
- **TextScaled gotcha** — `TextScaled = true` with a pure-scale `Size`
  (or no `Size`) collapses text to zero — now flagged with a fix
  recommendation.

### Color contrast warnings (off by default)

`luix.contrastWarnings.enabled` — flags any `TextColor3` whose
WCAG-AA contrast ratio against the nearest ancestor's
`BackgroundColor3` falls below 4.5:1. Both colors must be literal
Color3 expressions; reactive Fusion/Vide values are skipped.

### Design tokens beyond color

Mirror of `luix.palette` for two more types:

- **`luix.spacing`** — type `UDim.` to surface entries like
  `spacing.md` → `UDim.new(0, 16)`.
- **`luix.fonts`** — type `Font.` to surface entries like
  `fonts.display` → `Font.fromName("Gotham", Enum.FontWeight.Bold)`.

Empty by default; opt-in via user config.

### Color3 → palette extractor

Cursor on any Color3 literal → 💡 _Save Color3 to `luix.palette`…_ —
prompts for a token name and a target (User / Workspace settings).
The literal is added to `luix.palette` so it surfaces in future
`Color3.` completions.

### Frame-stats CodeLens (off by default)

`luix.frameStatsLens.enabled` — `▸ Frame — 24 descendants, 4 layers
deep` above every meaty subtree. `luix.frameStatsLens.minDescendants`
(default `5`) controls the threshold.

### Workspace-wide validation summary (off by default)

`luix.workspaceValidation.enabled` — the Luix sidebar shows
_"Project diagnostics — N warnings · M errors across X files"_.
Click jumps to the Problems panel. Aggregates Luix + every other
publisher's diagnostics.

### Class picker on `(` (off by default)

`luix.classNameCompletion.triggerOnOpenParen` — typing `e(` (without
a quote) opens the class picker; accepting inserts the full
`"ClassName", { … })` body. Off by default because `(` is a broad
trigger; on saves one keystroke per element when enabled.

### CFrame.Angles snippets

`cfangles` → `CFrame.Angles(math.rad(…), math.rad(…), math.rad(…))`
`cfanglesrad` → `CFrame.Angles(…, …, …)` (radians form)

### Background — workspace index persistence (on by default)

`luix.indexPersistence.enabled` — the parsed component index is now
saved to disk between sessions; unchanged files skip re-parsing on
cold start. Speeds up activation on large workspaces with no
behavioral difference. Disable to keep Luix offline.

### Background — opt-in Roblox API-dump augmentation

`luix.useRobloxApiDump` — fetch the community-maintained
Mini-API-Dump JSON once a day and _add_ any new properties Roblox has
shipped to existing classes' completion lists. Additive only — the
hand-curated built-in data still wins on conflicts.

### Roblox font family + weight autocomplete

- Inside `Font.fromName("…")`, the family dropdown surfaces 36
  built-in Roblox families with their supported weights. Popular UI
  families (BuilderSans, Gotham, Roboto, SourceSansPro, …) sort first.
- After `Enum.FontWeight.` inside a `Font.fromName(...)` call, the
  weight dropdown shows ONLY the weights the family actually ships.
  `Font.fromName("Cartoon", Enum.FontWeight.|)` lists just `Regular`;
  `Font.fromName("Roboto", Enum.FontWeight.|)` lists all nine.
- **`luix.customFonts`** lets you register custom font families and
  their supported weights — they merge into the same completions,
  surface above built-ins, and weight-filter the same way.

### `Font` (deprecated) removed from TextLabel / TextButton / TextBox

These classes no longer suggest the deprecated `Font` property —
only `FontFace` shows up in the completion list. The existing
deprecation diagnostic still catches anyone who writes
`Font = Enum.Font.X` and offers the _Replace with `FontFace = …`_
quick-fix.

### Smarter value completion for Color3 / UDim / Font props

Accepting `BackgroundColor3` / `TextColor3` / `Padding` / `FontFace`
now inserts a `Color3.` / `UDim.` / `Font.` prefix and auto-opens
the suggest dropdown. The dropdown lists:

- **Built-in constructors** first — `fromRGB`, `fromHex`, `new`,
  `fromHSV` (for Color3); `new` (for UDim); `fromName`, `fromId` (for
  Font). Picking one inserts the full call with per-channel tab stops
  preserved.
- **Tokens defined in your settings** below — `palette.primary`,
  `spacing.md`, `fonts.display`, … swap the prefix for the literal
  expression.

Type `f` to filter to constructors; type `p` (or `s` / `fonts`) to
filter to tokens.

### RichText `<font>` / `<stroke>` / `<mark>` — no more presumptuous defaults

Accepting one of these tags now leaves the attribute slot empty and
parks the cursor inside the tag. Type any letter and the attribute
completion fires — pick `color`, `size`, `weight`, etc. and the
value-with-quote pair fills in. Previously the snippet always
pre-filled `color="…"` regardless of intent.

### Other improvements

- Prop completion no longer doubles trailing commas: typing `Bac,`
  then accepting `BackgroundColor3` produces a single trailing comma
  with the cursor after it, regardless of the existing `,`.
- Prop / anchor-preset completions are now gated to _key_ position —
  typing `FontFace = Font.|` no longer surfaces `BackgroundColor3` /
  `anchor:c` / etc. alongside the font constructors.
- All settings now live under the `luix.*` prefix. The silent
  fallback to legacy `reactLuauPropsHelper.*` keys has been removed
  because VS Code's `inspect()` could mistake a user-set `{}` (equal
  to the default) for "not set" and quietly pick up the old keys.
  Anyone with stale `reactLuauPropsHelper.*` entries needs to rename
  them to `luix.*` (the format is identical).
- All user-visible strings, diagnostic codes, and the diagnostic
  collection have been re-branded from `react-luau-props-helper` to
  `luix` so the Problems panel and hover tooltips show the right
  source.
- `.vscodeignore` extended to exclude `devforum-post/`, design SVG /
  PNG drafts, `PUBLISHING.md`, lockfile, and tooling configs.
  Marketplace package size stays under ~135 KB.

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
/ similar _without_ a matching `AnchorPoint`, you get an Information-
level diagnostic with a _Add `AnchorPoint = Vector2.new(0.5, 0.5)`_
quick-fix that inserts the correct AnchorPoint at the right indentation.

### Wrap-in code actions

Cursor in any element call → lightbulb offers _Wrap in Frame_ / _Wrap
in ScrollingFrame_ / _Wrap in Frame + UIListLayout_. Framework-aware —
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

### Color3 picker now recognizes `fromHex` and `fromHSV`

The color swatch + picker fires on all four Color3 constructors —
`fromRGB`, `new`, `fromHex`, `fromHSV`. The picker presentation order
puts your existing notation first so editing visually never silently
flips your codebase from hex to RGB or vice versa.

### Convert Color3 between formats

Cursor on any Color3 literal → lightbulb offers _Convert to
`Color3.fromRGB(...)` / `fromHex(...)` / `new(...)` / `fromHSV(...)`_.
Resolves the actual color and rewrites the constructor.

### Reference CodeLens

Every component definition gets a `▸ N references` CodeLens above it.
Click to peek every workspace call site of `e(MyButton, …)`. Toggle
via **`luix.componentReferencesLens.enabled`**.

## [1.1.1]

### RichText color picker

VS Code's inline color swatch + picker now fires on
`color="#FF0000"` and `color="rgb(255, 0, 0)"` values inside `<font>`,
`<stroke>`, and `<mark>` tags — both forms parse, and editing via the
picker preserves whichever form you originally wrote (no surprise
hex↔rgb conversions). Gated by the new **`luix.richText.colorPicker`**
(default `true`) so users who disable Luix's Color3 picker
(`luix.colorPreview.enabled`) for extension-conflict reasons can still
keep the RichText one.

### Format settings for default color placeholders

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
key and offers a _Set `RichText = true`_ quick-fix that inserts the
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
  on `Frame`. Did you mean `Position`?" with a _Rename to `Position`_
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
`create "Fr|"`, or the Luau backtick form ``e(`Fr|`)`` now surfaces
Roblox class names. Accepting inserts the class name _and_, if the call
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

- New setting `luix.palette` — define named project colors. They
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
  swatch in the gutter plus VS Code's color picker.
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
