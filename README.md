# Luix

**All-in-one Roblox UI authoring helper for VS Code.** Luix understands
the call shapes of every popular Roblox UI framework — React-Luau,
Roact, Fusion, and Vide — and provides one consistent layer of editor
intelligence on top: prop completion, hover docs, inlay hints, color
preview, deprecation diagnostics, workspace-wide component inference,
and more.

Whether you write:

```lua
-- React-Luau / Roact
e("TextLabel", {
    Text = "Hello",
    -- type "Back" → suggest BackgroundColor3, BackgroundTransparency, …
})

-- Fusion
New "TextLabel" {
    Text = "Hello",
    -- same suggestions
    [OnEvent "MouseEnter"] = onHover,
}

-- Vide
create "TextLabel" {
    Text = "Hello",
    -- same suggestions, plus event names (Activated, MouseEnter, …)
    -- appear as regular props
}
```

— Luix offers the same prop completions, the same hover docs, the same
color picker, the same inlay hints. **One extension, every framework.**

---

## Supported frameworks

| Framework | Call shape | Children | Events |
| --- | --- | --- | --- |
| **React-Luau** | `e("Frame", { … }, { children })` | 3rd argument | `[React.Event.X] = fn` |
| **Roact** | `Roact.createElement("Frame", { … })` | 3rd argument | `[Roact.Event.X] = fn` |
| **Fusion** | `New "Frame" { … }` | `[Children] = { … }` | `[OnEvent "X"] = fn` |
| **Vide** | `create "Frame" { … }` | inline in same table | plain props (`X = fn`) |

Toggle which frameworks Luix recognises via `luix.frameworks` (default:
all four). Override the factory aliases per-framework via
`luix.<framework>.aliases` — useful if your codebase aliases the factory
locally, e.g. `local r = React.createElement` or `local n = Fusion.New`.

The first argument can be a string (`"TextLabel"`) or an identifier
(`MyButton`, `Components.Button`) — Luix handles both.

---

## Feature tour

### Prop completion with type-aware value snippets

Type any prop name inside an element table and accept the completion to
get a snippet wired up with tab stops:

| What you type | Inserted snippet |
| --- | --- |
| `BackgroundColor3` | `BackgroundColor3 = Color3.fromRGB(255, 255, 255),` |
| `Size` | `Size = UDim2.new(0, 0, 0, 0),` |
| `Interactable` | `Interactable = true\|false,` *(a toggleable choice)* |
| `FontFace` | `FontFace = Font.fromName("Montserrat", Enum.FontWeight.Regular),` |
| `Text` | `Text = "",` *(cursor inside the quotes)* |
| `HorizontalAlignment` | `HorizontalAlignment = Enum.HorizontalAlignment.,` |

Works identically across all four frameworks. Toggle with
`luix.typeAwareValues`.

### Outline + breadcrumbs

The VS Code Outline panel and breadcrumbs bar reflect the **React tree**
of the current file, not just its Lua function structure. Components
named via the `Name` prop are labelled with that name. `Cmd+Shift+O`
jumps straight to any element by name.

### Inlay hints at closing brackets

Every multi-line element gets a small label at its closing punctuation
so you can tell what just closed even ten levels deep:

```lua
e("Frame", {
    Name = "Container",
}, {
    e("Frame", {
        Name = "Inner",
    }, {
        e("TextLabel", { Text = "Hi" })  -- ▸ TextLabel
    })  -- ▸ Frame (Inner)
})  -- ▸ Frame (Container)
```

```lua
New "Frame" {
    Name = "Container",
    [Children] = {
        New "TextLabel" { Text = "Hi" }   -- ▸ TextLabel
    },
}                                          -- ▸ Frame (Container)
```

Default scope is `"ancestors"` — hints surface only on the chain
containing the cursor, so the file stays uncluttered. Switch to `"all"`
via `luix.inlayHints.scope`.

### Color preview

`Color3.fromRGB(R, G, B)` and `Color3.new(R, G, B)` get a swatch in the
gutter; click it for VS Code's colour picker. The picker offers both
output formats so you can edit visually and the file stays in whichever
notation your codebase prefers.

### Hover documentation

Hover any prop name inside an element table to see its type, the class
it was introduced on (walking the Roblox hierarchy), and a deep link to
the Roblox reference docs.

### Event completion

- **React/Roact** — typing `[React.Event.` (or `[Roact.Event.`) inside a
  props table lists the events available on the enclosing class
  (`Activated`, `MouseEnter`, `MouseButton1Click`, …). Same for
  `[React.Change.X]` listening to property changes.
- **Fusion** — typing `[OnEvent "M` suggests events as plain strings.
  *(Curried call detection is in place; richer in-bracket completion
  ships alongside it.)*
- **Vide** — events are plain table keys; Luix already merges the
  class's events into the prop suggestion list for you.

### Workspace-wide component inference

Use a component the way you use a host class:

```lua
local GamepassCard = require(script.Parent.GamepassCard)

-- Luix indexes every .lua/.luau file in the workspace at activation.
-- Typing inside e(GamepassCard, { … }) offers the props it can detect.
e(GamepassCard, {
    -- suggestions come from GamepassCard.lua's signature, annotations,
    -- or its root element. Works whether GamepassCard is React, Fusion,
    -- or Vide.
})
```

Four inference signals are checked, listed from least to most explicit:

1. **Auto-detection** from the component's root element. If the
   function returns `e("Frame", ...)`, `New "Frame" { … }`, or
   `create "Frame" { … }`, Luix uses that class's props.
2. **`---@extends ClassName` and `---@prop NAME [type]` annotations**
   placed above the function. Lua-LS–style triple-dash comments — read
   by Luix, ignored as a regular comment by every other tool.
3. **Typed `props` parameter** — inline literal type
   (`props: { gamepassId: number }`) or a same-file `type` alias.
4. **`luix.props`** central config — for components that live outside
   the workspace or need a global override.

> **Caveat: suggesting ≠ forwarding.** A suggested prop only takes
> effect if your component actually forwards it. If `GamepassCard`
> hardcodes all its `Frame` props, writing `BackgroundColor3 = …` at
> the call site does nothing. You'd merge `props` into the inner table
> (via `table.clone` or a dictionary-join helper) to make it pass
> through.

### Deprecation diagnostics + quick fixes

Yellow squigglies, one-click fixes:

- `Font = Enum.Font.GothamBold` → quick-fix replaces with
  `FontFace = Font.fromName("Gotham", Enum.FontWeight.Bold)`.
- `TextColor = …` (missing the trailing `3`) → quick-fix renames to
  `TextColor3`.

Toggle with `luix.deprecationDiagnostics` (default `true`).

### Auto-import (opt-in)

When enabled, `e(GamepassCard, { … })` for a component the workspace
knows about but the current file doesn't `require` gets an Information
diagnostic plus a quick-fix that inserts the require line near your
existing imports.

```jsonc
{
  "luix.autoImport.enabled": true,
  "luix.autoImport.style": "alias",
  "luix.autoImport.aliases": [
    {
      "filesystemPath": "src/Client/UI/Components",
      "robloxPath": "script.Components"
    },
    {
      "filesystemPath": "src/Shared/Packages",
      "robloxPath": "ReplicatedStorage.Packages"
    }
  ]
}
```

`"style": "relative"` produces `script.Parent…X` chains based on
filesystem position; `"style": "alias"` substitutes the prefixes above.

### Sidebar (Activity Bar)

Luix adds an Activity Bar entry with two views:

**Workspace** — context-sensitive project actions:

| Entry | Visible when | What it does |
| --- | --- | --- |
| ▸ Regenerate Wally types | `wally.toml` exists | Runs `wally install` → `rojo sourcemap` → `wally-package-types` in one chained command. |
| ▸ wally install | `wally.toml` exists | Just `wally install`. |
| ▸ Generate Rojo sourcemap | `*.project.json` exists | `rojo sourcemap <project> -o sourcemap.json` |
| ▸ New React component | always | Prompts for a name, creates `<Name>.luau` with a React-Luau scaffold, opens it. |
| ▸ New Fusion component | always | Same, Fusion `New "Frame" { [Children] = { … } }` template. |
| ▸ New Vide component | always | Same, Vide `create "Frame" { … }` template. |

All Wally/Rojo commands stream to a reusable named terminal ("Luix") so
you can watch and interrupt them.

**Components** — every UI component the workspace indexes. Two view
modes, toggled via the title-bar button:

- **Tree** (default): grouped by folder, mirroring how the files are
  organised on disk. Click an entry to jump to the function definition.
- **Flat**: alphabetical list of every component.

Only functions Luix is confident are UI components show up here — i.e.
those that either return an `e("…", …)` / `New "…" { … }` /
`create "…" { … }` element at the top level, **or** carry an explicit
`---@extends ClassName` annotation. Helper functions that happen to
take a `props` parameter are skipped.

Optionally pin the tree to a subfolder via `luix.componentsRoot`:

```jsonc
{
  "luix.componentsRoot": "src/Client/UI/Components"
}
```

When set, tree mode is rooted there; anything outside is hidden in
tree mode (flat mode still shows everything).

To create a new component in a *specific* folder, right-click that
folder in VS Code's Explorer and pick **Luix: New component here…** —
Luix prompts for the framework (React / Fusion / Vide) and the name,
then writes the file directly into that folder. The sidebar's
"New … component" buttons still work too; they open a folder picker
first.

Both views are also available via `Cmd+Shift+P` → search "Luix:".

### Color palette

Define named project colours via `luix.palette`. They appear as
completions when you type `Color3.` and the selected entry inserts the
full configured expression — keeping your design tokens consistent and
greppable.

```jsonc
{
  "luix.palette": {
    "primary":    "Color3.fromRGB(124, 92, 255)",
    "background": "Color3.fromRGB(21, 21, 26)",
    "surface":    "Color3.fromRGB(28, 30, 38)",
    "text":       "Color3.fromRGB(255, 255, 255)"
  }
}
```

In a Lua file:

```lua
BackgroundColor3 = Color3.|     -- typing `.` shows:
                                --   palette.primary
                                --   palette.background
                                --   palette.surface
                                --   palette.text
-- accepting `palette.surface` replaces `Color3.` with the full
-- `Color3.fromRGB(28, 30, 38)` expression.
```

### Snippets

Type the prefix, press `Tab`:

| Prefix | Frameworks | What it inserts |
| --- | --- | --- |
| `eFrame` / `eTextLabel` / `eTextButton` / `eImageLabel` / `eImageButton` / `eScrollingFrame` | React-Luau | `e("X", { … }, { … })` |
| `nFrame` / `nTextLabel` / `nTextButton` | Fusion | `New "X" { … }` with `[Children]` slot |
| `cFrame` / `cTextLabel` / `cTextButton` | Vide | `create "X" { … }` with inline children |
| `eUIListLayout` / `eUIGridLayout` / `eUIPadding` / `eUICorner` / `eUIStroke` | any | the corresponding utility |
| `useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` | React-Luau hooks | the hook call |
| `reactEvent` | React-Luau | `[React.Event.X] = function(rbx) … end,` |
| `rfc` | React-Luau | function-component scaffold |

---

## Custom component annotations

Two forms work, and they compose:

```lua
---@extends Frame
---@prop gamepassId number
---@prop layoutOrder number?
local function GamepassCard(props): React.ReactNode
    return e("Frame", { … })
end
```

```lua
type GamepassCardProps = {
    gamepassId: number,
    layoutOrder: number?,
}

local function GamepassCard(props: GamepassCardProps)
    return New "Frame" { … }
end
```

The `---@extends` directive declares the class the component conceptually
extends — its prop list gets merged into the component's suggestions.
`---@prop` adds explicit per-component props on top. The typed parameter
form does the same thing via Luau types.

---

## Configuration

All settings live under the `luix.*` prefix. Open `Cmd+,` and search
"Luix" to see them in the UI, or write them directly into your
`settings.json`.

### Framework toggles

```jsonc
{
  // Toggle which frameworks Luix scans for.
  "luix.frameworks": ["react", "roact", "fusion", "vide"],

  // Override per-framework factory aliases (leave empty to use defaults).
  "luix.react.aliases":   [],  // defaults: ["e", "createElement", "React.createElement"]
  "luix.roact.aliases":   [],  // defaults: ["Roact.createElement"]
  "luix.fusion.aliases":  [],  // defaults: ["New", "Fusion.New"]
  "luix.vide.aliases":    []   // defaults: ["create", "vide.create"]
}
```

### Per-class prop overrides

```jsonc
{
  "luix.props": {
    // Array form — override the prop list for a class.
    "Frame": ["Size", "Position", "BackgroundColor3"],

    // Empty array disables suggestions for that class.
    "TextBox": [],

    // Custom component, flat list.
    "MyButton": ["label", "onClick", "disabled"],

    // Custom component that extends a Roblox class plus extras.
    "GamepassCard": {
      "extends": "Frame",
      "props": ["gamepassId", "layoutOrder"]
    }
  }
}
```

### Editor integrations

```jsonc
{
  "luix.documentSymbols.enabled": true,
  "luix.colorPreview.enabled":    true,
  "luix.inlayHints.enabled":      true,
  "luix.inlayHints.scope":        "ancestors",   // or "all"
  "luix.inlayHints.position":     "after-comma", // or "before-comma"
  "luix.deprecationDiagnostics":  true,
  "luix.warnReservedPropNames":   false,
  "luix.typeAwareValues":         true,
  "luix.snippetMode":             "value-with-comma"  // or "value" / "name-only"
}
```

### Auto-import (opt-in)

```jsonc
{
  "luix.autoImport.enabled": false,
  "luix.autoImport.style":   "relative",  // or "alias"
  "luix.autoImport.aliases": [
    { "filesystemPath": "src/Client/UI/Components", "robloxPath": "script.Components" }
  ]
}
```

---

## Known limitations

- **Parsing is text-based**, not AST-based. Strings, comments, and Luau
  block structure are tracked, but pathological inputs (very unusual
  macro/codegen output, type intersections like `Frame & Foo`,
  generics like `Props<T>`) can confuse the detector.
- **Cross-file lookups are name-based.** If two files declare a
  component called `Button`, the first one scanned wins. Pin the
  intended one via `luix.props` if it matters.
- **First top-level return wins.** Components that conditionally
  return different element classes have the first one used as the
  implicit base.
- **Suggesting ≠ forwarding.** Luix shows what a component *could*
  accept; making it actually accept those props is on the
  implementation.

---

## Development

```sh
npm install
npm run compile       # one-shot
npm run watch         # rebuild on save
npm run lint
npm test              # headless VS Code with the extension loaded
npm run build-icon    # rerender assets/icon.png from assets/icon.svg
```

Press **F5** from this folder in VS Code to launch an Extension
Development Host with Luix loaded.
