// Constants, lookup tables, and pure data helpers.
//
// Nothing in this file imports from `vscode`; it's safe to consume from
// tests without spinning up the extension host.

// ============================================================================
// Roblox class hierarchy
// ============================================================================

export interface ClassDef {
  inherits?: string;
  own: string[];
  events?: string[];
}

// Hierarchy roughly mirrors Roblox's actual one (see
// https://create.roblox.com/docs/reference/engine/classes/GuiObject), with a
// few pragmatic shortcuts:
//   - TextButton / TextBox extend TextLabel for sharing text props (Roblox
//     keeps them as siblings, but the prop sets overlap entirely).
//   - ImageButton extends ImageLabel for the same reason.
//   - The various UILayout subclasses share `FillDirection`,
//     `HorizontalAlignment`, etc. via a `UILayout` base.
export const classHierarchy: Record<string, ClassDef> = {
  // ---- roots ----
  Instance: { own: ["Name"] },

  GuiBase2d: { inherits: "Instance", own: ["AutoLocalize"] },

  // ---- 2D UI base ----
  GuiObject: {
    inherits: "GuiBase2d",
    own: [
      "Active",
      "AnchorPoint",
      "AutomaticSize",
      "BackgroundColor3",
      "BackgroundTransparency",
      "BorderColor3",
      "BorderMode",
      "BorderSizePixel",
      "ClipsDescendants",
      "Interactable",
      "LayoutOrder",
      "NextSelectionDown",
      "NextSelectionLeft",
      "NextSelectionRight",
      "NextSelectionUp",
      "Position",
      "Rotation",
      "Selectable",
      "SelectionImageObject",
      "SelectionOrder",
      "Size",
      "SizeConstraint",
      "Visible",
      "ZIndex",
    ],
    events: [
      "InputBegan",
      "InputChanged",
      "InputEnded",
      "MouseEnter",
      "MouseLeave",
      "MouseMoved",
      "MouseWheelBackward",
      "MouseWheelForward",
      "SelectionGained",
      "SelectionLost",
      "TouchLongPress",
      "TouchPan",
      "TouchPinch",
      "TouchRotate",
      "TouchSwipe",
      "TouchTap",
    ],
  },

  // Synthetic level: shared by TextButton and ImageButton.
  GuiButton: {
    inherits: "GuiObject",
    own: ["AutoButtonColor", "Modal", "Selected"],
    events: [
      "Activated",
      "MouseButton1Click",
      "MouseButton1Down",
      "MouseButton1Up",
      "MouseButton2Click",
      "MouseButton2Down",
      "MouseButton2Up",
    ],
  },

  // ---- Frame family ----
  Frame: { inherits: "GuiObject", own: [] },

  ScrollingFrame: {
    inherits: "GuiObject",
    own: [
      "AutomaticCanvasSize",
      "BottomImage",
      "CanvasPosition",
      "CanvasSize",
      "ElasticBehavior",
      "HorizontalScrollBarInset",
      "MidImage",
      "ScrollBarImageColor3",
      "ScrollBarImageTransparency",
      "ScrollBarThickness",
      "ScrollingDirection",
      "ScrollingEnabled",
      "TopImage",
      "VerticalScrollBarInset",
      "VerticalScrollBarPosition",
    ],
  },

  ViewportFrame: {
    inherits: "GuiObject",
    own: [
      "Ambient",
      "CurrentCamera",
      "ImageColor3",
      "ImageTransparency",
      "LightColor",
      "LightDirection",
    ],
  },

  VideoFrame: {
    inherits: "GuiObject",
    own: ["Looped", "Playing", "TimePosition", "Video", "Volume"],
  },

  CanvasGroup: {
    inherits: "GuiObject",
    own: ["GroupColor3", "GroupTransparency"],
  },

  // ---- Text family ----
  // TextLabel acts as the shared base for everything that renders text;
  // TextButton and TextBox add their own extras on top.
  TextLabel: {
    inherits: "GuiObject",
    own: [
      "Font",
      "FontFace",
      "LineHeight",
      "MaxVisibleGraphemes",
      "RichText",
      "Text",
      "TextColor3",
      "TextDirection",
      "TextScaled",
      "TextSize",
      "TextStrokeColor3",
      "TextStrokeTransparency",
      "TextTransparency",
      "TextTruncate",
      "TextWrapped",
      "TextXAlignment",
      "TextYAlignment",
    ],
  },

  // TextButton acts like a button + a label. We model it as inheriting
  // GuiButton (for the button extras and click events) and bolt the
  // text-rendering props on directly.
  TextButton: {
    inherits: "GuiButton",
    own: [
      // Mirrored from TextLabel for the prop list:
      "Font",
      "FontFace",
      "LineHeight",
      "MaxVisibleGraphemes",
      "RichText",
      "Text",
      "TextColor3",
      "TextDirection",
      "TextScaled",
      "TextSize",
      "TextStrokeColor3",
      "TextStrokeTransparency",
      "TextTransparency",
      "TextTruncate",
      "TextWrapped",
      "TextXAlignment",
      "TextYAlignment",
    ],
  },

  TextBox: {
    inherits: "TextLabel",
    own: [
      "ClearTextOnFocus",
      "CursorPosition",
      "MultiLine",
      "PlaceholderColor3",
      "PlaceholderText",
      "SelectionStart",
      "ShowNativeInput",
      "TextEditable",
    ],
    events: [
      "Focused",
      "FocusLost",
      "ReturnPressedFromOnScreenKeyboard",
      "TextChanged",
    ],
  },

  // ---- Image family ----
  ImageLabel: {
    inherits: "GuiObject",
    own: [
      "Image",
      "ImageColor3",
      "ImageRectOffset",
      "ImageRectSize",
      "ImageTransparency",
      "ResampleMode",
      "ScaleType",
      "SliceCenter",
      "SliceScale",
      "TileSize",
    ],
  },

  // ImageButton: GuiButton + ImageLabel props bolted on.
  ImageButton: {
    inherits: "GuiButton",
    own: [
      "HoverImage",
      "PressedImage",
      // Mirrored from ImageLabel:
      "Image",
      "ImageColor3",
      "ImageRectOffset",
      "ImageRectSize",
      "ImageTransparency",
      "ResampleMode",
      "ScaleType",
      "SliceCenter",
      "SliceScale",
      "TileSize",
    ],
  },

  // ---- LayerCollectors (root containers — not GuiObjects) ----
  ScreenGui: {
    inherits: "Instance",
    own: [
      "AutoLocalize",
      "ClipToDeviceSafeArea",
      "DisplayOrder",
      "Enabled",
      "IgnoreGuiInset",
      "ResetOnSpawn",
      "SafeAreaCompatibility",
      "ScreenInsets",
      "ZIndexBehavior",
    ],
  },

  BillboardGui: {
    inherits: "Instance",
    own: [
      "Active",
      "AlwaysOnTop",
      "Brightness",
      "ClipsDescendants",
      "DistanceLowerLimit",
      "DistanceStep",
      "DistanceUpperLimit",
      "Enabled",
      "ExtentsOffset",
      "ExtentsOffsetWorldSpace",
      "LightInfluence",
      "MaxDistance",
      "PlayerToHideFrom",
      "Size",
      "SizeOffset",
      "StudsOffset",
      "StudsOffsetWorldSpace",
      "ZIndexBehavior",
    ],
  },

  SurfaceGui: {
    inherits: "Instance",
    own: [
      "Adornee",
      "AlwaysOnTop",
      "Brightness",
      "CanvasSize",
      "ClipsDescendants",
      "Enabled",
      "Face",
      "LightInfluence",
      "PixelsPerStud",
      "ResetOnSpawn",
      "SizingMode",
      "ToolPunchThroughDistance",
      "ZIndexBehavior",
    ],
  },

  // ---- UI utilities ----
  UICorner: { inherits: "Instance", own: ["CornerRadius"] },

  UIGradient: {
    inherits: "Instance",
    own: ["Color", "Enabled", "Offset", "Rotation", "Transparency"],
  },

  UIStroke: {
    inherits: "Instance",
    own: [
      "ApplyStrokeMode",
      "Color",
      "Enabled",
      "LineJoinMode",
      "Thickness",
      "Transparency",
    ],
  },

  UIPadding: {
    inherits: "Instance",
    own: ["PaddingBottom", "PaddingLeft", "PaddingRight", "PaddingTop"],
  },

  UIScale: { inherits: "Instance", own: ["Scale"] },

  UIFlexItem: {
    inherits: "Instance",
    own: ["FlexMode", "GrowRatio", "ItemLineAlignment", "ShrinkRatio"],
  },

  // ---- Layout family ----
  UILayout: {
    inherits: "Instance",
    own: [
      "FillDirection",
      "HorizontalAlignment",
      "Padding",
      "SortOrder",
      "VerticalAlignment",
    ],
  },

  UIListLayout: {
    inherits: "UILayout",
    own: ["HorizontalFlex", "ItemLineAlignment", "VerticalFlex", "Wraps"],
  },

  UIGridLayout: {
    inherits: "UILayout",
    own: ["CellPadding", "CellSize", "FillDirectionMaxCells", "StartCorner"],
  },

  UIPageLayout: {
    inherits: "UILayout",
    own: [
      "Animated",
      "Circular",
      "EasingDirection",
      "EasingStyle",
      "GamepadInputEnabled",
      "PageSize",
      "ScrollWheelInputEnabled",
      "TouchInputEnabled",
    ],
  },

  UITableLayout: {
    inherits: "UILayout",
    own: [
      "ColumnSpacing",
      "FillEmptySpaceColumns",
      "FillEmptySpaceRows",
      "MajorAxis",
      "RowSpacing",
    ],
  },

  // ---- Constraints ----
  UIAspectRatioConstraint: {
    inherits: "Instance",
    own: ["AspectRatio", "AspectType", "DominantAxis"],
  },

  UISizeConstraint: { inherits: "Instance", own: ["MaxSize", "MinSize"] },

  UITextSizeConstraint: {
    inherits: "Instance",
    own: ["MaxTextSize", "MinTextSize"],
  },
};

// Memoized; the hierarchy is static, so the result for a given class never
// changes. Callers must treat the returned array as immutable.
const propsCache = new Map<string, string[]>();

export function flattenClassProps(
  className: string,
  seen: Set<string> = new Set()
): string[] {
  if (seen.has(className)) {
    return [];
  }
  // Only memoize the top-level call (when no parent passed `seen` in).
  const topLevel = seen.size === 0;
  if (topLevel) {
    const hit = propsCache.get(className);
    if (hit !== undefined) {
      return hit;
    }
  }
  seen.add(className);

  const def = classHierarchy[className];
  if (!def) {
    if (topLevel) {
      propsCache.set(className, []);
    }
    return [];
  }
  const inherited = def.inherits
    ? flattenClassProps(def.inherits, seen)
    : [];
  const out: string[] = [];
  for (const p of inherited) {
    if (!out.includes(p)) {
      out.push(p);
    }
  }
  for (const p of def.own) {
    if (!out.includes(p)) {
      out.push(p);
    }
  }
  if (topLevel) {
    propsCache.set(className, out);
  }
  return out;
}

const eventsCache = new Map<string, string[]>();

export function flattenClassEvents(
  className: string,
  seen: Set<string> = new Set()
): string[] {
  if (seen.has(className)) {
    return [];
  }
  const topLevel = seen.size === 0;
  if (topLevel) {
    const hit = eventsCache.get(className);
    if (hit !== undefined) {
      return hit;
    }
  }
  seen.add(className);

  const def = classHierarchy[className];
  if (!def) {
    if (topLevel) {
      eventsCache.set(className, []);
    }
    return [];
  }
  const inherited = def.inherits
    ? flattenClassEvents(def.inherits, seen)
    : [];
  const out: string[] = [];
  for (const e of inherited) {
    if (!out.includes(e)) {
      out.push(e);
    }
  }
  for (const e of def.events ?? []) {
    if (!out.includes(e)) {
      out.push(e);
    }
  }
  if (topLevel) {
    eventsCache.set(className, out);
  }
  return out;
}

/**
 * Returns the class in the hierarchy where `propName` is first declared
 * (its `own` array contains it). Useful for hover docs.
 */
export function findIntroducingClass(
  className: string,
  propName: string
): string | undefined {
  let current: string | undefined = className;
  while (current) {
    const def: ClassDef | undefined = classHierarchy[current];
    if (!def) {
      return undefined;
    }
    if (def.own.includes(propName)) {
      return current;
    }
    current = def.inherits;
  }
  return undefined;
}

// Built-in defaults derived from the hierarchy. Same flat shape downstream
// code already expects (Record<string, string[]>).
export const defaultPropsMap: Record<string, string[]> = Object.fromEntries(
  Object.keys(classHierarchy).map((name) => [name, flattenClassProps(name)])
);

// ============================================================================
// createElement aliases
// ============================================================================

export const DEFAULT_ALIASES = [
  "e",
  "createElement",
  "React.createElement",
  "Roact.createElement",
];

// ============================================================================
// Prop types + value snippet templates
// ============================================================================

// Map of prop name → Roblox type. Used to insert a value snippet when the
// user accepts a completion. Conservative — only props whose type is
// unambiguous across all classes that have them.
export const PROP_TYPES: Record<string, string> = {
  // Color3
  Ambient: "Color3",
  BackgroundColor3: "Color3",
  BorderColor3: "Color3",
  GroupColor3: "Color3",
  ImageColor3: "Color3",
  LightColor: "Color3",
  PlaceholderColor3: "Color3",
  ScrollBarImageColor3: "Color3",
  TextColor3: "Color3",
  TextStrokeColor3: "Color3",

  // UDim2
  CanvasSize: "UDim2",
  CellPadding: "UDim2",
  CellSize: "UDim2",
  PageSize: "UDim2",
  Position: "UDim2",
  Size: "UDim2",
  StudsOffset: "Vector3",

  // UDim
  ColumnSpacing: "UDim",
  CornerRadius: "UDim",
  Padding: "UDim",
  PaddingBottom: "UDim",
  PaddingLeft: "UDim",
  PaddingRight: "UDim",
  PaddingTop: "UDim",
  RowSpacing: "UDim",

  // Vector2
  AnchorPoint: "Vector2",
  CanvasPosition: "Vector2",
  ExtentsOffset: "Vector2",
  ExtentsOffsetWorldSpace: "Vector2",
  ImageRectOffset: "Vector2",
  ImageRectSize: "Vector2",
  MaxSize: "Vector2",
  MinSize: "Vector2",
  SizeOffset: "Vector2",
  StudsOffsetWorldSpace: "Vector3",
  TileSize: "UDim2",

  // Vector3
  LightDirection: "Vector3",

  // number
  AspectRatio: "number",
  BackgroundTransparency: "number",
  BorderSizePixel: "number",
  Brightness: "number",
  CursorPosition: "number",
  DisplayOrder: "number",
  DistanceLowerLimit: "number",
  DistanceStep: "number",
  DistanceUpperLimit: "number",
  GrowRatio: "number",
  GroupTransparency: "number",
  ImageTransparency: "number",
  LayoutOrder: "number",
  LightInfluence: "number",
  LineHeight: "number",
  MaxDistance: "number",
  MaxTextSize: "number",
  MaxVisibleGraphemes: "number",
  MinTextSize: "number",
  PixelsPerStud: "number",
  Rotation: "number",
  Scale: "number",
  ScrollBarImageTransparency: "number",
  ScrollBarThickness: "number",
  SelectionOrder: "number",
  SelectionStart: "number",
  ShrinkRatio: "number",
  SliceScale: "number",
  TextSize: "number",
  TextStrokeTransparency: "number",
  TextTransparency: "number",
  Thickness: "number",
  TimePosition: "number",
  ToolPunchThroughDistance: "number",
  Volume: "number",
  ZIndex: "number",

  // boolean
  Active: "boolean",
  AlwaysOnTop: "boolean",
  Animated: "boolean",
  AutoButtonColor: "boolean",
  AutoLocalize: "boolean",
  Circular: "boolean",
  ClearTextOnFocus: "boolean",
  ClipsDescendants: "boolean",
  ClipToDeviceSafeArea: "boolean",
  Enabled: "boolean",
  FillEmptySpaceColumns: "boolean",
  FillEmptySpaceRows: "boolean",
  GamepadInputEnabled: "boolean",
  IgnoreGuiInset: "boolean",
  Interactable: "boolean",
  Looped: "boolean",
  Modal: "boolean",
  MultiLine: "boolean",
  Playing: "boolean",
  ResetOnSpawn: "boolean",
  RichText: "boolean",
  ScrollingEnabled: "boolean",
  ScrollWheelInputEnabled: "boolean",
  Selectable: "boolean",
  Selected: "boolean",
  ShowNativeInput: "boolean",
  TextEditable: "boolean",
  TextScaled: "boolean",
  TextWrapped: "boolean",
  TouchInputEnabled: "boolean",
  Visible: "boolean",
  Wraps: "boolean",

  // string
  BottomImage: "string",
  HoverImage: "string",
  Image: "string",
  MidImage: "string",
  Name: "string",
  PlaceholderText: "string",
  PressedImage: "string",
  Text: "string",
  TopImage: "string",
  Video: "string",

  // Font (struct)
  FontFace: "Font",

  // Enum.* — generic-enum templates rendered as `Enum.<X>.${1}`
  ApplyStrokeMode: "Enum.ApplyStrokeMode",
  AspectType: "Enum.AspectType",
  AutomaticCanvasSize: "Enum.AutomaticSize",
  AutomaticSize: "Enum.AutomaticSize",
  BorderMode: "Enum.BorderMode",
  DominantAxis: "Enum.DominantAxis",
  EasingDirection: "Enum.EasingDirection",
  EasingStyle: "Enum.EasingStyle",
  ElasticBehavior: "Enum.ElasticBehavior",
  FillDirection: "Enum.FillDirection",
  FlexMode: "Enum.UIFlexMode",
  Font: "Enum.Font",
  HorizontalAlignment: "Enum.HorizontalAlignment",
  HorizontalFlex: "Enum.UIFlexAlignment",
  HorizontalScrollBarInset: "Enum.ScrollBarInset",
  ItemLineAlignment: "Enum.ItemLineAlignment",
  LineJoinMode: "Enum.LineJoinMode",
  MajorAxis: "Enum.TableMajorAxis",
  ResampleMode: "Enum.ResamplerMode",
  SafeAreaCompatibility: "Enum.SafeAreaCompatibility",
  ScaleType: "Enum.ScaleType",
  ScreenInsets: "Enum.ScreenInsets",
  ScrollingDirection: "Enum.ScrollingDirection",
  SizeConstraint: "Enum.SizeConstraint",
  SizingMode: "Enum.SurfaceGuiSizingMode",
  SortOrder: "Enum.SortOrder",
  StartCorner: "Enum.StartCorner",
  TextDirection: "Enum.TextDirection",
  TextTruncate: "Enum.TextTruncate",
  TextXAlignment: "Enum.TextXAlignment",
  TextYAlignment: "Enum.TextYAlignment",
  VerticalAlignment: "Enum.VerticalAlignment",
  VerticalFlex: "Enum.UIFlexAlignment",
  VerticalScrollBarInset: "Enum.ScrollBarInset",
  VerticalScrollBarPosition: "Enum.VerticalScrollBarPosition",
  ZIndexBehavior: "Enum.ZIndexBehavior",
};

// Snippet templates per type. `${1:…}`, `${2:…}` become tab stops; the
// caller appends `$0` (and a `,` if value-with-comma mode) after the
// rendered template.
export const TYPE_SNIPPETS: Record<string, string> = {
  Color3: "Color3.fromRGB(${1:255}, ${2:255}, ${3:255})",
  UDim2: "UDim2.new(${1:0}, ${2:0}, ${3:0}, ${4:0})",
  UDim: "UDim.new(${1:0}, ${2:0})",
  Vector2: "Vector2.new(${1:0}, ${2:0})",
  Vector3: "Vector3.new(${1:0}, ${2:0}, ${3:0})",
  CFrame: "CFrame.new(${1:0}, ${2:0}, ${3:0})",
  number: "${1:0}",
  string: '"${1}"',
  boolean: "${1|true,false|}",
  Font: 'Font.fromName("${1:Montserrat}", Enum.FontWeight.${2:Regular})',
};

export function renderTypeSnippet(typeName: string): string | undefined {
  const direct = TYPE_SNIPPETS[typeName];
  if (direct) {
    return direct;
  }
  if (typeName.startsWith("Enum.")) {
    return `Enum.${typeName.slice("Enum.".length)}.\${1}`;
  }
  return undefined;
}

// ============================================================================
// Annotation completion: types offered after `---@prop NAME `
// ============================================================================

export const ANNOTATION_TYPE_HINTS = [
  // Roblox value types
  "Color3",
  "UDim",
  "UDim2",
  "Vector2",
  "Vector3",
  "CFrame",
  "Font",
  "ColorSequence",
  "NumberSequence",
  "NumberRange",
  "Rect",
  "Region3",
  "BrickColor",
  "Instance",
  // Primitives
  "number",
  "string",
  "boolean",
  "nil",
  "any",
  "unknown",
  // Common React-Luau types
  "React.ReactNode",
  "React.Ref",
];

// ============================================================================
// Font.fromName replacement table (for the Font → FontFace quick-fix)
// ============================================================================

// Conservative Enum.Font.* → (family, weight, italic?) translation for the
// Font → FontFace quick fix. Unknown values fall back to the original
// suffix as the family name; users can edit afterwards.
export const FONT_FACE_MAP: Record<
  string,
  { family: string; weight: string; italic?: boolean }
> = {
  SourceSans: { family: "Source Sans Pro", weight: "Regular" },
  SourceSansBold: { family: "Source Sans Pro", weight: "Bold" },
  SourceSansLight: { family: "Source Sans Pro", weight: "Light" },
  SourceSansSemibold: { family: "Source Sans Pro", weight: "SemiBold" },
  SourceSansItalic: {
    family: "Source Sans Pro",
    weight: "Regular",
    italic: true,
  },
  Gotham: { family: "Gotham", weight: "Regular" },
  GothamMedium: { family: "Gotham", weight: "Medium" },
  GothamBold: { family: "Gotham", weight: "Bold" },
  GothamBlack: { family: "Gotham", weight: "Heavy" },
  GothamSemibold: { family: "Gotham", weight: "SemiBold" },
  Arial: { family: "Arial", weight: "Regular" },
  ArialBold: { family: "Arial", weight: "Bold" },
  Cartoon: { family: "Bangers", weight: "Regular" },
  Code: { family: "Source Code Pro", weight: "Regular" },
  Highway: { family: "Highway Gothic", weight: "Regular" },
  SciFi: { family: "Zekton", weight: "Regular" },
  Bodoni: { family: "Bodoni", weight: "Regular" },
  Garamond: { family: "Garamond", weight: "Regular" },
  Fantasy: { family: "Fantasy", weight: "Regular" },
  Antique: { family: "Antique", weight: "Regular" },
  Legacy: { family: "Legacy", weight: "Regular" },
  Michroma: { family: "Michroma", weight: "Regular" },
  Roboto: { family: "Roboto", weight: "Regular" },
  RobotoCondensed: { family: "Roboto Condensed", weight: "Regular" },
  RobotoMono: { family: "Roboto Mono", weight: "Regular" },
  Merriweather: { family: "Merriweather", weight: "Regular" },
  Nunito: { family: "Nunito", weight: "Regular" },
  Oswald: { family: "Oswald", weight: "Regular" },
  PatrickHand: { family: "Patrick Hand", weight: "Regular" },
  PermanentMarker: { family: "Permanent Marker", weight: "Regular" },
  Ubuntu: { family: "Ubuntu", weight: "Regular" },
};

export function buildFontFaceReplacement(enumName: string): string {
  const mapped = FONT_FACE_MAP[enumName];
  if (!mapped) {
    return `Font.fromName("${enumName}", Enum.FontWeight.Regular)`;
  }
  if (mapped.italic) {
    return `Font.new(Font.fromName("${mapped.family}", Enum.FontWeight.${mapped.weight}).Family, Enum.FontWeight.${mapped.weight}, Enum.FontStyle.Italic)`;
  }
  return `Font.fromName("${mapped.family}", Enum.FontWeight.${mapped.weight})`;
}
