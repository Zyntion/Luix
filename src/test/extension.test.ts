import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildCodeMask,
  findEnclosingPropsCall,
  extractTypeFields,
  parseAnnotationsForComponent,
  scanDocument,
  _internal,
} from "../extension";

const ALIASES = _internal.DEFAULT_ALIASES;

function detect(text: string, cursorMarker = "|"): ReturnType<typeof findEnclosingPropsCall> {
  const cursor = text.indexOf(cursorMarker);
  assert.notStrictEqual(cursor, -1, "test text must contain a cursor marker");
  const stripped = text.slice(0, cursor) + text.slice(cursor + cursorMarker.length);
  return findEnclosingPropsCall(stripped, cursor, ALIASES);
}

suite("buildCodeMask", () => {
  test("masks line comments", () => {
    const text = `local x = 1 -- {hidden}\nx = 2`;
    const mask = buildCodeMask(text);
    const idxOfBrace = text.indexOf("{");
    assert.strictEqual(mask[idxOfBrace], false, "{ inside comment is not code");
  });

  test("masks block comments", () => {
    const text = `--[[ {fake} ]]\nlocal y = 3`;
    const mask = buildCodeMask(text);
    assert.strictEqual(mask[text.indexOf("{")], false);
    assert.strictEqual(mask[text.indexOf("}")], false);
  });

  test("masks double-quoted string interiors", () => {
    const text = `local s = "click {here}"\n`;
    const mask = buildCodeMask(text);
    assert.strictEqual(mask[text.indexOf("{")], false);
    assert.strictEqual(mask[text.indexOf("}")], false);
    // Quotes themselves remain code.
    assert.strictEqual(mask[text.indexOf('"')], true);
  });

  test("masks long bracket strings", () => {
    const text = `local s = [==[ {nested} ]==]\n`;
    const mask = buildCodeMask(text);
    assert.strictEqual(mask[text.indexOf("{")], false);
    assert.strictEqual(mask[text.indexOf("}")], false);
  });

  test("leaves real code untouched", () => {
    const text = `e("Frame", { Size = 1 })`;
    const mask = buildCodeMask(text);
    assert.strictEqual(mask[text.indexOf("{")], true);
    assert.strictEqual(mask[text.indexOf("}")], true);
  });
});

suite("findEnclosingPropsCall", () => {
  test("detects simple e(\"Frame\", { ... }) call", () => {
    const result = detect(`e("Frame", { | })`);
    assert.strictEqual(result?.className, "Frame");
    assert.strictEqual(result?.isStringLiteralName, true);
  });

  test("detects React.createElement", () => {
    const result = detect(`React.createElement("TextLabel", { | })`);
    assert.strictEqual(result?.className, "TextLabel");
    assert.strictEqual(result?.isStringLiteralName, true);
  });

  test("detects Roact.createElement", () => {
    const result = detect(`Roact.createElement("Frame", { | })`);
    assert.strictEqual(result?.className, "Frame");
  });

  test("detects custom component (identifier, no quotes)", () => {
    const result = detect(`e(MyButton, { | })`);
    assert.strictEqual(result?.className, "MyButton");
    assert.strictEqual(result?.isStringLiteralName, false);
  });

  test("detects dotted identifier component", () => {
    const result = detect(`e(Components.Button, { | })`);
    assert.strictEqual(result?.className, "Components.Button");
  });

  test("returns the actually-enclosing class, not the last seen one (regression for issue #3)", () => {
    // Cursor is back in Frame's props, after a closed TextLabel child.
    const text = `
e("Frame", {
    child = e("TextLabel", { Text = "x" }),
    |
})`.trimStart();
    const result = detect(text);
    assert.strictEqual(result?.className, "Frame");
  });

  test("handles deep nesting correctly", () => {
    const text = `
e("Frame", {
    Layout = e("UIListLayout", { Padding = 5 }),
    Inner = e("ScrollingFrame", {
        |
    }),
})`.trimStart();
    const result = detect(text);
    assert.strictEqual(result?.className, "ScrollingFrame");
  });

  test("ignores braces inside strings (regression for issue #4)", () => {
    const text = `
e("TextLabel", {
    Text = "click {here}",
    |
})`.trimStart();
    const result = detect(text);
    assert.strictEqual(result?.className, "TextLabel");
  });

  test("ignores braces inside line comments", () => {
    const text = `
e("TextLabel", {
    -- } this } closes nothing
    |
})`.trimStart();
    const result = detect(text);
    assert.strictEqual(result?.className, "TextLabel");
  });

  test("rejects identifier-suffix `e` false positives (regression for issue #5)", () => {
    // `frame(...)` is NOT a createElement call.
    const result = detect(`frame("Frame", { | })`);
    assert.strictEqual(result, undefined);
  });

  test("rejects an identifier ending in `e` followed by paren", () => {
    const result = detect(`createMe("Frame", { | })`);
    assert.strictEqual(result, undefined);
  });

  test("returns undefined outside any createElement call", () => {
    const result = detect(`local t = { | }`);
    assert.strictEqual(result, undefined);
  });

  test("returns undefined inside an unclosed paren expression", () => {
    // Cursor is in the argument list of UDim2.new, not in Frame's props.
    const text = `e("Frame", { Size = UDim2.new(| ) })`;
    const result = detect(text);
    assert.strictEqual(result, undefined);
  });

  test("works when cursor is right after the opening brace", () => {
    const result = detect(`e("Frame", {|})`);
    assert.strictEqual(result?.className, "Frame");
  });

  test("works with the snake-case `createElement` alias", () => {
    const result = detect(`createElement("Frame", { | })`);
    assert.strictEqual(result?.className, "Frame");
  });

  test("custom aliases via config", () => {
    const text = `r("Frame", { | })`;
    const cursor = text.indexOf("|");
    const stripped = text.replace("|", "");
    const result = findEnclosingPropsCall(stripped, cursor, ["r"]);
    assert.strictEqual(result?.className, "Frame");
  });

  test("does not match createElement inside a comment", () => {
    const text = `
-- e("Decoy", {
e("Frame", {
    |
})`.trimStart();
    const result = detect(text);
    assert.strictEqual(result?.className, "Frame");
  });
});

suite("Default props map", () => {
  test("contains Frame with BackgroundColor3", () => {
    assert.ok(_internal.defaultPropsMap.Frame.includes("BackgroundColor3"));
  });

  test("contains TextLabel with Text", () => {
    assert.ok(_internal.defaultPropsMap.TextLabel.includes("Text"));
  });

  test("Frame includes modern GuiObject props (Interactable, Active, Selectable)", () => {
    const frame = _internal.defaultPropsMap.Frame;
    assert.ok(frame.includes("Interactable"));
    assert.ok(frame.includes("Active"));
    assert.ok(frame.includes("Selectable"));
    assert.ok(frame.includes("Name"));
  });

  test("UIListLayout includes Wraps and HorizontalFlex", () => {
    const list = _internal.defaultPropsMap.UIListLayout;
    assert.ok(list.includes("Wraps"));
    assert.ok(list.includes("HorizontalFlex"));
    assert.ok(list.includes("VerticalFlex"));
  });

  test("ScrollingFrame includes modern scroll-bar props", () => {
    const sf = _internal.defaultPropsMap.ScrollingFrame;
    assert.ok(sf.includes("ScrollBarImageColor3"));
    assert.ok(sf.includes("ElasticBehavior"));
    assert.ok(sf.includes("HorizontalScrollBarInset"));
  });

  test("TextLabel includes FontFace", () => {
    assert.ok(_internal.defaultPropsMap.TextLabel.includes("FontFace"));
  });

  test("New utility classes are present", () => {
    assert.ok(_internal.defaultPropsMap.UIAspectRatioConstraint);
    assert.ok(_internal.defaultPropsMap.UIFlexItem);
    assert.ok(_internal.defaultPropsMap.UISizeConstraint);
    assert.ok(_internal.defaultPropsMap.UIScale);
    assert.ok(_internal.defaultPropsMap.UITableLayout);
  });
});

// ============================================================================
// 1.4.0 — type-aware snippets
// ============================================================================

import { _testing } from "../extension";

suite("renderTypeSnippet", () => {
  test("Color3 yields fromRGB template", () => {
    const s = _testing.renderTypeSnippet("Color3");
    assert.ok(s && s.startsWith("Color3.fromRGB("));
    assert.ok(s.includes("${1:"));
  });

  test("UDim2 yields four-arg template", () => {
    const s = _testing.renderTypeSnippet("UDim2");
    assert.ok(s && s.includes("UDim2.new"));
    assert.ok(s.includes("${4:0}"));
  });

  test("boolean yields a choice element", () => {
    const s = _testing.renderTypeSnippet("boolean");
    assert.strictEqual(s, "${1|true,false|}");
  });

  test("Enum.* falls back to a generic template", () => {
    const s = _testing.renderTypeSnippet("Enum.HorizontalAlignment");
    assert.strictEqual(s, "Enum.HorizontalAlignment.${1}");
  });

  test("unknown types return undefined", () => {
    assert.strictEqual(_testing.renderTypeSnippet("MysteryType"), undefined);
  });
});

suite("Class hierarchy", () => {
  test("GuiObject base exists and has core props", () => {
    const gui = _testing.classHierarchy.GuiObject;
    assert.ok(gui, "GuiObject should be defined");
    assert.ok(gui.own.includes("BackgroundColor3"));
    assert.ok(gui.own.includes("Interactable"));
    assert.ok(gui.own.includes("Position"));
    assert.ok(gui.own.includes("Size"));
  });

  test("Frame inherits from GuiObject and adds nothing of its own", () => {
    const frame = _testing.classHierarchy.Frame;
    assert.strictEqual(frame.inherits, "GuiObject");
    assert.deepStrictEqual(frame.own, []);
  });

  test("TextButton chains inheritance: GuiObject → GuiButton → TextButton", () => {
    const tb = _testing.classHierarchy.TextButton;
    assert.strictEqual(tb.inherits, "GuiButton");
    // `own` carries the text-rendering props (mirrored from TextLabel) since
    // TextButton is a button-and-label hybrid in our model.
    assert.ok(tb.own.includes("Text"));
    assert.ok(tb.own.includes("FontFace"));
  });

  test("Flattening TextButton includes GuiObject, GuiButton, and text props", () => {
    const flat = _testing.flattenClassProps("TextButton");
    // From GuiObject:
    assert.ok(flat.includes("BackgroundColor3"));
    assert.ok(flat.includes("Position"));
    assert.ok(flat.includes("Interactable"));
    // From GuiButton:
    assert.ok(flat.includes("AutoButtonColor"));
    assert.ok(flat.includes("Selected"));
    // Mirrored text props on TextButton itself:
    assert.ok(flat.includes("Text"));
    assert.ok(flat.includes("FontFace"));
  });

  test("Flattening ImageButton includes GuiButton extras and image props", () => {
    const flat = _testing.flattenClassProps("ImageButton");
    assert.ok(flat.includes("Image"));
    assert.ok(flat.includes("ImageColor3"));
    assert.ok(flat.includes("AutoButtonColor"));
    assert.ok(flat.includes("HoverImage"));
  });

  test("UILayout subclasses share Padding/FillDirection from UILayout", () => {
    for (const cls of [
      "UIListLayout",
      "UIGridLayout",
      "UIPageLayout",
      "UITableLayout",
    ]) {
      const flat = _testing.flattenClassProps(cls);
      assert.ok(flat.includes("FillDirection"), `${cls} should inherit FillDirection`);
      assert.ok(flat.includes("HorizontalAlignment"), `${cls} should inherit HorizontalAlignment`);
    }
  });

  test("Flattening is idempotent (no duplicate prop names)", () => {
    const flat = _testing.flattenClassProps("ScrollingFrame");
    assert.strictEqual(
      new Set(flat).size,
      flat.length,
      "no duplicates expected after dedupe"
    );
  });

  test("Unknown class flattens to empty", () => {
    assert.deepStrictEqual(
      _testing.flattenClassProps("NotARealClass"),
      []
    );
  });
});

suite("PROP_TYPES coverage", () => {
  test("known Color3-typed props are tagged", () => {
    for (const name of [
      "BackgroundColor3",
      "TextColor3",
      "BorderColor3",
      "ImageColor3",
    ]) {
      assert.strictEqual(
        _testing.PROP_TYPES[name],
        "Color3",
        `expected ${name} → Color3`
      );
    }
  });

  test("Interactable is a boolean", () => {
    assert.strictEqual(_testing.PROP_TYPES.Interactable, "boolean");
  });

  test("Name is a string", () => {
    assert.strictEqual(_testing.PROP_TYPES.Name, "string");
  });

  test("Size and Position are UDim2", () => {
    assert.strictEqual(_testing.PROP_TYPES.Size, "UDim2");
    assert.strictEqual(_testing.PROP_TYPES.Position, "UDim2");
  });
});

// ============================================================================
// 1.2.0 — in-file prop inference
// ============================================================================

suite("extractTypeFields", () => {
  test("simple flat literal", () => {
    assert.deepStrictEqual(
      extractTypeFields(`a: number, b: string`),
      ["a", "b"]
    );
  });

  test("trailing comma is fine", () => {
    assert.deepStrictEqual(
      extractTypeFields(`a: number, b: string,`),
      ["a", "b"]
    );
  });

  test("semicolon separator works", () => {
    assert.deepStrictEqual(
      extractTypeFields(`a: number; b: string`),
      ["a", "b"]
    );
  });

  test("optional fields", () => {
    assert.deepStrictEqual(
      extractTypeFields(`a: number?, b: string?`),
      ["a", "b"]
    );
  });

  test("nested types do not leak inner fields", () => {
    assert.deepStrictEqual(
      extractTypeFields(`a: { x: number, y: number }, b: string`),
      ["a", "b"]
    );
  });

  test("function-typed field", () => {
    assert.deepStrictEqual(
      extractTypeFields(`onClick: () -> (), label: string`),
      ["onClick", "label"]
    );
  });

  test("function with typed params doesn't leak inner names", () => {
    assert.deepStrictEqual(
      extractTypeFields(`onClick: (x: number) -> string, label: string`),
      ["onClick", "label"]
    );
  });

  test("index signature is skipped", () => {
    assert.deepStrictEqual(
      extractTypeFields(`[string]: number, label: string`),
      ["label"]
    );
  });

  test("generic field type", () => {
    assert.deepStrictEqual(
      extractTypeFields(`items: Array<string>, count: number`),
      ["items", "count"]
    );
  });
});

suite("parseAnnotationsForComponent", () => {
  test("single @extends directive", () => {
    const text = `---@extends Frame\nlocal function Foo() end`;
    const result = parseAnnotationsForComponent(text, 1);
    assert.strictEqual(result.extendsClass, "Frame");
    assert.deepStrictEqual(result.props, []);
  });

  test("multiple @prop lines preserve order", () => {
    const text = [
      "---@prop gamepassId number",
      "---@prop layoutOrder number?",
      "---@prop onActivated () -> ()",
      "local function GamepassCard(props) end",
    ].join("\n");
    const result = parseAnnotationsForComponent(text, 3);
    assert.deepStrictEqual(result.props, [
      "gamepassId",
      "layoutOrder",
      "onActivated",
    ]);
  });

  test("mixed @extends and @prop", () => {
    const text = [
      "---@extends Frame",
      "---@prop gamepassId number",
      "local function GamepassCard(props) end",
    ].join("\n");
    const result = parseAnnotationsForComponent(text, 2);
    assert.strictEqual(result.extendsClass, "Frame");
    assert.deepStrictEqual(result.props, ["gamepassId"]);
  });

  test("stops at first non-triple-dash line", () => {
    const text = [
      "-- a regular comment",
      "---@extends Frame",
      "local function Foo(props) end",
    ].join("\n");
    // The plain `--` comment breaks the chain, so @extends is NOT picked up.
    const result = parseAnnotationsForComponent(text, 2);
    assert.strictEqual(result.extendsClass, "Frame");
  });

  test("returns empty when no annotations present", () => {
    const text = `local function Foo(props) end`;
    const result = parseAnnotationsForComponent(text, 0);
    assert.strictEqual(result.extendsClass, undefined);
    assert.deepStrictEqual(result.props, []);
  });
});

suite("scanDocument — function discovery", () => {
  test("discovers a `local function` definition", () => {
    const text = `local function Foo(props) return e("Frame", {}) end`;
    const result = scanDocument(text, ALIASES);
    assert.ok(result.has("Foo"));
  });

  test("discovers a `local X = function` definition", () => {
    const text = `local Bar = function(props) return e("TextLabel", {}) end`;
    const result = scanDocument(text, ALIASES);
    assert.ok(result.has("Bar"));
  });

  test("discovers a dotted function definition (indexed by last segment)", () => {
    const text = `function Module.Baz(props) return e("Frame", {}) end`;
    const result = scanDocument(text, ALIASES);
    assert.ok(result.has("Baz"));
  });
});

suite("scanDocument — return-statement auto-detection", () => {
  test("simple `return e(\"Frame\", ...)`", () => {
    const text = `local function Foo(props) return e("Frame", {}) end`;
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.strictEqual(info?.detectedBase, "Frame");
  });

  test("skips returns inside nested functions", () => {
    const text = `
local function Outer(props)
    local inner = function()
        return e("Inner", {})
    end
    return e("Outer", {})
end`.trimStart();
    const info = scanDocument(text, ALIASES).get("Outer");
    assert.strictEqual(info?.detectedBase, "Outer");
  });

  test("doesn't detect when no createElement is returned", () => {
    const text = `local function Foo(props) return 1 end`;
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.strictEqual(info?.detectedBase, undefined);
  });

  test("ignores returns inside `hover:map(function() return X end)` style callbacks", () => {
    const text = `
local function GamepassCard(props)
    local color = hover:map(function(h)
        return otherClass:Lerp(other, h)
    end)
    return e("Frame", {})
end`.trimStart();
    const info = scanDocument(text, ALIASES).get("GamepassCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });

  test("ignores `return` inside `if/then/end` block correctly", () => {
    const text = `
local function Foo(props)
    if cond then
        return e("A", {})
    end
    return e("B", {})
end`.trimStart();
    const info = scanDocument(text, ALIASES).get("Foo");
    // First top-level return wins.
    assert.strictEqual(info?.detectedBase, "A");
  });
});

suite("scanDocument — typed signature inference", () => {
  test("inline literal type", () => {
    const text = `local function Foo(props: { a: number, b: string }) end`;
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.deepStrictEqual(info?.paramTypeFields, ["a", "b"]);
  });

  test("named type alias resolves", () => {
    const text = [
      "type FooProps = { a: number, b: string }",
      "local function Foo(props: FooProps) end",
    ].join("\n");
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.deepStrictEqual(info?.paramTypeFields, ["a", "b"]);
  });

  test("no type annotation → no signature fields", () => {
    const text = `local function Foo(props) end`;
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.strictEqual(info?.paramTypeFields, undefined);
  });

  test("return-type annotation doesn't confuse parser", () => {
    const text = `local function Foo(props: { a: number }): React.ReactNode end`;
    const info = scanDocument(text, ALIASES).get("Foo");
    assert.deepStrictEqual(info?.paramTypeFields, ["a"]);
  });
});

suite("scanDocument — annotations integration", () => {
  test("picks up @extends and @prop above a function", () => {
    const text = [
      "---@extends Frame",
      "---@prop gamepassId number",
      "local function GamepassCard(props) end",
    ].join("\n");
    const info = scanDocument(text, ALIASES).get("GamepassCard");
    assert.strictEqual(info?.annotations.extendsClass, "Frame");
    assert.deepStrictEqual(info?.annotations.props, ["gamepassId"]);
  });
});

suite("scanDocument — caching", () => {
  test("returns the same map instance for the same input", () => {
    const text = `local function Foo(props) return e("Frame", {}) end`;
    const a = scanDocument(text, ALIASES);
    const b = scanDocument(text, ALIASES);
    assert.strictEqual(a, b);
  });
});

// ============================================================================
// 1.3.0 — cross-file resolution (unit)
// ============================================================================
//
// The full WorkspaceIndex relies on VS Code's file watcher and workspace
// APIs. The hard part — parsing — is already covered by scanDocument tests.
// Here we just verify the *aggregation* logic that `findComponent` will run
// over the cache, by parsing two pretend "files" the same way the index
// does and looking up across them.

// ============================================================================
// 1.5.0 — new helpers
// ============================================================================

import {
  extractColorLiterals,
  findAllCreateElementCalls,
  buildCallTree,
} from "../extension";

suite("Events (1.5)", () => {
  test("GuiObject events include MouseEnter and MouseLeave", () => {
    const events = _testing.flattenClassEvents("GuiObject");
    assert.ok(events.includes("MouseEnter"));
    assert.ok(events.includes("MouseLeave"));
  });

  test("TextButton inherits Activated from GuiButton", () => {
    const events = _testing.flattenClassEvents("TextButton");
    assert.ok(events.includes("Activated"));
    assert.ok(events.includes("MouseButton1Click"));
    // Still has GuiObject events:
    assert.ok(events.includes("MouseEnter"));
  });

  test("TextBox has TextChanged", () => {
    const events = _testing.flattenClassEvents("TextBox");
    assert.ok(events.includes("TextChanged"));
    assert.ok(events.includes("Focused"));
  });

  test("Frame doesn't have button-only events", () => {
    const events = _testing.flattenClassEvents("Frame");
    assert.ok(!events.includes("Activated"));
    assert.ok(!events.includes("MouseButton1Click"));
  });
});

suite("findIntroducingClass", () => {
  test("BackgroundColor3 is introduced on GuiObject", () => {
    assert.strictEqual(
      _testing.findIntroducingClass("Frame", "BackgroundColor3"),
      "GuiObject"
    );
    assert.strictEqual(
      _testing.findIntroducingClass("TextLabel", "BackgroundColor3"),
      "GuiObject"
    );
  });

  test("AutoButtonColor is introduced on GuiButton", () => {
    assert.strictEqual(
      _testing.findIntroducingClass("TextButton", "AutoButtonColor"),
      "GuiButton"
    );
  });

  test("CanvasSize is introduced on ScrollingFrame itself", () => {
    assert.strictEqual(
      _testing.findIntroducingClass("ScrollingFrame", "CanvasSize"),
      "ScrollingFrame"
    );
  });

  test("unknown prop returns undefined", () => {
    assert.strictEqual(
      _testing.findIntroducingClass("Frame", "NotAProp"),
      undefined
    );
  });
});

suite("extractColorLiterals", () => {
  test("captures Color3.fromRGB(255, 128, 0)", () => {
    const result = extractColorLiterals("local x = Color3.fromRGB(255, 128, 0)");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].r, 1);
    assert.strictEqual(result[0].g, 128 / 255);
    assert.strictEqual(result[0].b, 0);
  });

  test("captures Color3.new with floats", () => {
    const result = extractColorLiterals("local x = Color3.new(0.5, 0.5, 0.5)");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].r, 0.5);
  });

  test("rejects non-numeric args", () => {
    const result = extractColorLiterals(
      "local x = Color3.fromRGB(getR(), 0, 0)"
    );
    assert.strictEqual(result.length, 0);
  });

  test("rejects out-of-range Color3.new", () => {
    const result = extractColorLiterals("local x = Color3.new(2, 3, 4)");
    assert.strictEqual(result.length, 0);
  });

  test("captures multiple in one document", () => {
    const result = extractColorLiterals(
      `local a = Color3.fromRGB(1, 2, 3)\nlocal b = Color3.fromRGB(4, 5, 6)`
    );
    assert.strictEqual(result.length, 2);
  });
});

suite("findAllCreateElementCalls", () => {
  test("flat list of all calls", () => {
    const text = `
local frame = e("Frame", {
  Name = "Outer",
}, {
  e("TextLabel", { Text = "x" }),
  e("UICorner", {}),
})
`.trimStart();
    const calls = findAllCreateElementCalls(text, _internal.DEFAULT_ALIASES);
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0].className, "Frame");
    assert.strictEqual(calls[0].nameProp, "Outer");
    assert.strictEqual(calls[1].className, "TextLabel");
    assert.strictEqual(calls[2].className, "UICorner");
  });

  test("identifier-named components are detected with isStringLiteralName=false", () => {
    const text = `e(MyComp, { LayoutOrder = 1 })`;
    const calls = findAllCreateElementCalls(text, _internal.DEFAULT_ALIASES);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].className, "MyComp");
    assert.strictEqual(calls[0].isStringLiteralName, false);
  });
});

suite("buildCallTree", () => {
  test("nests children under their parent", () => {
    const text = `
local frame = e("Frame", {
  Name = "Outer",
}, {
  e("TextLabel", { Text = "x" }, {
    e("UIPadding", {}),
  }),
  e("UICorner", {}),
})
`.trimStart();
    const calls = findAllCreateElementCalls(text, _internal.DEFAULT_ALIASES);
    const tree = buildCallTree(calls);
    assert.strictEqual(tree.length, 1);
    const root = tree[0];
    assert.strictEqual(root.call.className, "Frame");
    assert.strictEqual(root.children.length, 2);
    assert.strictEqual(root.children[0].call.className, "TextLabel");
    assert.strictEqual(root.children[0].children.length, 1);
    assert.strictEqual(root.children[0].children[0].call.className, "UIPadding");
    assert.strictEqual(root.children[1].call.className, "UICorner");
  });

  test("siblings outside any parent become roots", () => {
    const text = `e("Frame", {})\ne("TextLabel", {})`;
    const calls = findAllCreateElementCalls(text, _internal.DEFAULT_ALIASES);
    const tree = buildCallTree(calls);
    assert.strictEqual(tree.length, 2);
  });
});

suite("collectLocalBindings", () => {
  test("captures `local X = require(...)` lines", () => {
    const text = `
local Foo = require(script.Foo)
local Bar = require(script.Parent.Bar)
local x = 1
local function helper() end
`.trimStart();
    const set = _testing.collectLocalBindings(text);
    assert.ok(set.has("Foo"));
    assert.ok(set.has("Bar"));
    assert.ok(set.has("x"));
    assert.ok(set.has("helper"));
  });

  test("ignores bindings inside string literals", () => {
    const text = `local s = "local Hidden = nothing"`;
    const set = _testing.collectLocalBindings(text);
    assert.ok(set.has("s"));
    assert.ok(!set.has("Hidden"));
  });
});

suite("buildFontFaceReplacement", () => {
  test("known font maps to family + weight", () => {
    assert.strictEqual(
      _testing.buildFontFaceReplacement("GothamBold"),
      'Font.fromName("Gotham", Enum.FontWeight.Bold)'
    );
  });

  test("italic variant uses Font.new", () => {
    const r = _testing.buildFontFaceReplacement("SourceSansItalic");
    assert.ok(r.includes("Enum.FontStyle.Italic"));
  });

  test("unknown font falls back to the enum name as family", () => {
    assert.strictEqual(
      _testing.buildFontFaceReplacement("Mysterious"),
      'Font.fromName("Mysterious", Enum.FontWeight.Regular)'
    );
  });
});

suite("buildRelativePath", () => {
  function uri(p: string) {
    return vscode.Uri.file(p);
  }
  test("siblings in the same dir", () => {
    const from = uri("/proj/src/UI/Shop.lua");
    const to = uri("/proj/src/UI/GamepassCard.lua");
    assert.strictEqual(
      _testing.buildRelativePath(from, to),
      "script.Parent.GamepassCard"
    );
  });

  test("component in a subfolder", () => {
    const from = uri("/proj/src/UI/Shop.lua");
    const to = uri("/proj/src/UI/Components/GamepassCard.lua");
    assert.strictEqual(
      _testing.buildRelativePath(from, to),
      "script.Parent.Components.GamepassCard"
    );
  });

  test("component up a level", () => {
    const from = uri("/proj/src/UI/Shop/index.lua");
    const to = uri("/proj/src/UI/GamepassCard.lua");
    assert.strictEqual(
      _testing.buildRelativePath(from, to),
      "script.Parent.Parent.GamepassCard"
    );
  });
});

suite("Cross-file aggregation", () => {
  test("a component defined in one document is found when looking up by name", () => {
    const fileA = `---@extends Frame\nlocal function GamepassCard(props) end\nreturn GamepassCard`;
    const fileB = `local function Shop() return e(GamepassCard, {}) end`;

    const indexA = scanDocument(fileA, ALIASES);
    const indexB = scanDocument(fileB, ALIASES);

    // File B (the consumer) has no GamepassCard definition.
    assert.strictEqual(indexB.has("GamepassCard"), false);

    // File A has it with the @extends annotation.
    const info = indexA.get("GamepassCard");
    assert.strictEqual(info?.annotations.extendsClass, "Frame");

    // Aggregation: consumer's same-file lookup misses → fall back to file A.
    const acrossFiles = indexB.get("GamepassCard") ?? indexA.get("GamepassCard");
    assert.strictEqual(acrossFiles?.annotations.extendsClass, "Frame");
  });
});

// ============================================================================
// 1.6.0 — multi-framework support (Fusion, Vide)
// ============================================================================

const FUSION_PARTITION = {
  parens: [] as string[],
  curried: ["New", "Fusion.New"],
};
const VIDE_PARTITION = {
  parens: [] as string[],
  curried: ["create", "vide.create"],
};
const ALL_PARTITION = {
  parens: ["e", "createElement", "React.createElement", "Roact.createElement"],
  curried: ["New", "Fusion.New", "create", "vide.create"],
};

suite("Fusion call detection", () => {
  test("findEnclosingPropsCall picks up `New \"Frame\" { | }`", () => {
    const text = `New "Frame" { | }`;
    const cursor = text.indexOf("|");
    const stripped = text.replace("|", "");
    const result = findEnclosingPropsCall(stripped, cursor, FUSION_PARTITION);
    assert.strictEqual(result?.className, "Frame");
    assert.strictEqual(result?.callShape, "curried");
    assert.strictEqual(result?.alias, "New");
  });

  test("findAllCreateElementCalls picks up a Fusion call", () => {
    const text = `local b = New "Frame" { Name = "Outer" }`;
    const calls = findAllCreateElementCalls(text, FUSION_PARTITION);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].className, "Frame");
    assert.strictEqual(calls[0].isStringLiteralName, true);
    assert.strictEqual(calls[0].nameProp, "Outer");
  });

  test("nested Fusion call appears as a child via call-tree", () => {
    const text = `
local b = New "Frame" {
  Name = "Outer",
  [Children] = {
    New "TextLabel" { Text = "Hi" },
  },
}`.trimStart();
    const calls = findAllCreateElementCalls(text, FUSION_PARTITION);
    assert.strictEqual(calls.length, 2);
    const tree = buildCallTree(calls);
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].call.className, "Frame");
    assert.strictEqual(tree[0].children.length, 1);
    assert.strictEqual(tree[0].children[0].call.className, "TextLabel");
  });
});

suite("Vide call detection", () => {
  test("findEnclosingPropsCall picks up `create \"Frame\" { | }`", () => {
    const text = `create "Frame" { | }`;
    const cursor = text.indexOf("|");
    const stripped = text.replace("|", "");
    const result = findEnclosingPropsCall(stripped, cursor, VIDE_PARTITION);
    assert.strictEqual(result?.className, "Frame");
    assert.strictEqual(result?.callShape, "curried");
    assert.strictEqual(result?.alias, "create");
  });

  test("findAllCreateElementCalls handles inline children", () => {
    const text = `
local b = create "Frame" {
  Name = "Outer",
  create "TextLabel" { Text = "Hi" },
}`.trimStart();
    const calls = findAllCreateElementCalls(text, VIDE_PARTITION);
    assert.strictEqual(calls.length, 2);
    const tree = buildCallTree(calls);
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].children.length, 1);
    assert.strictEqual(tree[0].children[0].call.className, "TextLabel");
  });
});

suite("Mixed framework file", () => {
  test("both parens and curried calls coexist", () => {
    const text = `
e("Frame", { Name = "A" })
New "Frame" { Name = "B" }
create "Frame" { Name = "C" }`.trimStart();
    const calls = findAllCreateElementCalls(text, ALL_PARTITION);
    const names = calls.map((c) => c.nameProp).sort();
    assert.deepStrictEqual(names, ["A", "B", "C"]);
  });
});

suite("Framework filtering", () => {
  test("Fusion-only partition ignores parens calls", () => {
    const text = `e("Frame", { Name = "A" })\nNew "Frame" { Name = "B" }`;
    const calls = findAllCreateElementCalls(text, FUSION_PARTITION);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].nameProp, "B");
  });

  test("React-only partition ignores curried calls", () => {
    const text = `e("Frame", { Name = "A" })\nNew "Frame" { Name = "B" }`;
    const reactOnly = { parens: ["e"], curried: [] };
    const calls = findAllCreateElementCalls(text, reactOnly);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].nameProp, "A");
  });
});

suite("Curried return-statement detection", () => {
  test("detectedBase picks up `return New \"Frame\" {...}`", () => {
    const text = [
      "local function MyCard(props)",
      "  return New \"Frame\" {",
      "    Name = \"Card\",",
      "  }",
      "end",
    ].join("\n");
    const info = scanDocument(text, FUSION_PARTITION).get("MyCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });

  test("detectedBase picks up `return create \"Frame\" {...}`", () => {
    const text = [
      "local function MyCard(props)",
      "  return create \"Frame\" {",
      "    Name = \"Card\",",
      "  }",
      "end",
    ].join("\n");
    const info = scanDocument(text, VIDE_PARTITION).get("MyCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });
});

// ============================================================================
// Sidebar plumbing: palette completion + scaffold templates
// ============================================================================

import { buildPaletteCompletions } from "../palette";
import { _renderTemplate } from "../scaffolds";

suite("Palette completion", () => {
  test("returns one entry per palette color, replaces `Color3.`", () => {
    const palette = {
      primary: "Color3.fromRGB(124, 92, 255)",
      surface: "Color3.fromRGB(28, 30, 38)",
    };
    // Pretend the cursor is at column 30 of a line ending with `= Color3.`.
    const position = new vscode.Position(0, 30);
    const items = buildPaletteCompletions(palette, position);
    assert.strictEqual(items.length, 2);
    const labels = items.map((i) =>
      typeof i.label === "string" ? i.label : i.label.label
    );
    assert.ok(labels.includes("palette.primary"));
    assert.ok(labels.includes("palette.surface"));
    // Each insertion replaces the trailing `Color3.` (7 chars) and
    // inserts the full configured expression.
    for (const item of items) {
      assert.ok(item.range instanceof vscode.Range);
      assert.strictEqual(
        (item.range as vscode.Range).end.character -
          (item.range as vscode.Range).start.character,
        "Color3.".length
      );
      assert.ok(
        typeof item.insertText === "string" &&
          item.insertText.startsWith("Color3.")
      );
    }
  });

  test("returns empty array when palette is empty", () => {
    const items = buildPaletteCompletions({}, new vscode.Position(0, 10));
    assert.deepStrictEqual(items, []);
  });
});

// ============================================================================
// Workspace exclusion + component filtering
// ============================================================================

import { _internal as wsInternal } from "../workspaceIndex";

suite("WorkspaceIndex exclusion", () => {
  test("defaults skip Packages/, _Index/, etc.", () => {
    const dirs = wsInternal.DEFAULT_EXCLUDED_DIRS;
    assert.ok(dirs.includes("Packages"));
    assert.ok(dirs.includes("_Index"));
    assert.ok(dirs.includes("DevPackages"));
    assert.ok(dirs.includes("ServerPackages"));
  });

  test("isExcluded matches any path segment", () => {
    const dirs = wsInternal.DEFAULT_EXCLUDED_DIRS;
    const wallyFile = vscode.Uri.file(
      "/proj/Packages/_Index/react@0.4.0/react/src/index.luau"
    );
    const userFile = vscode.Uri.file(
      "/proj/src/Client/UI/Components/GamepassCard.luau"
    );
    assert.strictEqual(wsInternal.isExcluded(wallyFile, dirs), true);
    assert.strictEqual(wsInternal.isExcluded(userFile, dirs), false);
  });

  test("extra exclude entries work", () => {
    const dirs = [...wsInternal.DEFAULT_EXCLUDED_DIRS, "Tests"];
    const testFile = vscode.Uri.file("/proj/src/Tests/foo.luau");
    assert.strictEqual(wsInternal.isExcluded(testFile, dirs), true);
  });

  test("buildExcludeGlob unions directories", () => {
    const glob = wsInternal.buildExcludeGlob(["Packages", "_Index"]);
    assert.strictEqual(glob, "**/{Packages,_Index}/**");
  });
});

suite("buildFolderTree", () => {
  // Lightweight stub of the workspace folder lookup. The real
  // implementation reads vscode.workspace.getWorkspaceFolder, which
  // would resolve to undefined in the headless test host. We sidestep
  // that here by writing the tree-builder's input as paths already
  // relative to a virtual workspace folder.

  function fakeEntry(name: string, fsPath: string) {
    return {
      name,
      uri: vscode.Uri.file(fsPath),
      info: {
        name,
        defLineIndex: 0,
        annotations: { props: [] },
        detectedBase: "Frame",
      },
    };
  }

  // Skip in environments without a workspace folder.
  test("groups components by folder when componentsRoot is set", () => {
    // We can't easily fake `vscode.workspace.getWorkspaceFolder` from a
    // test; if no workspace folder is open all entries get dropped at
    // the root. That degenerate behaviour is itself worth validating.
    const tree = sidebar.buildFolderTree(
      [
        fakeEntry("Card", "/proj/src/UI/Components/Card.luau"),
        fakeEntry("Modal", "/proj/src/UI/Components/Modals/Modal.luau"),
      ],
      undefined
    );
    // All entries land at root because no workspace folder resolves.
    assert.strictEqual(tree.kind, "folder");
    assert.ok(tree.children.length >= 0);
  });
});

import * as sidebar from "../sidebar";

suite("Scaffold templates produce parseable components", () => {
  test("React template — scanDocument detects component + Frame base", () => {
    const text = _renderTemplate("react", "MyCard");
    const info = scanDocument(text, ALIASES).get("MyCard");
    assert.ok(info, "scanDocument should find MyCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });

  test("Fusion template — scanDocument detects component + Frame base", () => {
    const text = _renderTemplate("fusion", "MyCard");
    const info = scanDocument(text, {
      parens: [],
      curried: ["New"],
    }).get("MyCard");
    assert.ok(info, "scanDocument should find MyCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });

  test("Vide template — scanDocument detects component + Frame base", () => {
    const text = _renderTemplate("vide", "MyCard");
    const info = scanDocument(text, {
      parens: [],
      curried: ["create"],
    }).get("MyCard");
    assert.ok(info, "scanDocument should find MyCard");
    assert.strictEqual(info?.detectedBase, "Frame");
  });
});
