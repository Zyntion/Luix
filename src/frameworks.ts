// Framework specifications. Each entry tells the parser which call shapes
// to recognise and how the framework's quirks (children layout, events as
// props, etc.) should be reflected in completions and inlay hints.

import { getConfig } from "./configCompat";

export type FrameworkId = "react" | "roact" | "fusion" | "vide";

export interface FrameworkSpec {
  id: FrameworkId;
  /** Function-name aliases used to construct elements. */
  aliases: string[];
  /**
   * Call shape:
   *   - `parens`: `f(a, b, c)` (React, Roact)
   *   - `curried`: Lua sugar `f "x" { ... }` (Fusion, Vide)
   */
  callShape: "parens" | "curried";
  /**
   * For "curried" frameworks: how children appear.
   *   - `table-key`: children under a special key like `[Children]`.
   *   - `inline`: children are array-style entries in the same table as
   *     props.
   */
  childrenLayout?: "table-key" | "inline";
  /** For `table-key` childrenLayout, the key name (e.g. `"Children"`). */
  childrenKey?: string;
  /**
   * Whether event names should be merged into the prop-completion list.
   * Vide treats events as plain table keys (`Activated = function()...`)
   * rather than the `[React.Event.X]` bracket form.
   */
  eventsAsProps: boolean;
}

export const FRAMEWORKS: Record<FrameworkId, FrameworkSpec> = {
  react: {
    id: "react",
    aliases: ["e", "createElement", "React.createElement"],
    callShape: "parens",
    eventsAsProps: false,
  },
  roact: {
    id: "roact",
    aliases: ["Roact.createElement"],
    callShape: "parens",
    eventsAsProps: false,
  },
  fusion: {
    id: "fusion",
    aliases: ["New", "Fusion.New"],
    callShape: "curried",
    childrenLayout: "table-key",
    childrenKey: "Children",
    eventsAsProps: false,
  },
  vide: {
    id: "vide",
    aliases: ["create", "vide.create"],
    callShape: "curried",
    childrenLayout: "inline",
    eventsAsProps: true,
  },
};

const ALL_FRAMEWORK_IDS: FrameworkId[] = ["react", "roact", "fusion", "vide"];

/**
 * Returns the active framework specs, filtered by the `luix.frameworks`
 * setting and with any per-framework alias overrides applied.
 */
export function getEnabledFrameworks(): FrameworkSpec[] {
  const enabled = getConfig<FrameworkId[]>("frameworks", ALL_FRAMEWORK_IDS);
  const ids = Array.isArray(enabled) && enabled.length > 0
    ? enabled.filter((id): id is FrameworkId =>
        ALL_FRAMEWORK_IDS.includes(id as FrameworkId)
      )
    : ALL_FRAMEWORK_IDS;

  return ids.map((id) => {
    const base = FRAMEWORKS[id];
    const override = getConfig<string[]>(`${id}.aliases`, []);
    if (Array.isArray(override) && override.length > 0) {
      return { ...base, aliases: override };
    }
    return base;
  });
}

/**
 * Collected aliases across all enabled frameworks, partitioned by call
 * shape. Parsers use this to build two separate regexes.
 */
export interface AliasPartition {
  parens: string[];
  curried: string[];
}

export function getAliasPartition(): AliasPartition {
  const result: AliasPartition = { parens: [], curried: [] };
  for (const framework of getEnabledFrameworks()) {
    const bucket =
      framework.callShape === "parens" ? result.parens : result.curried;
    for (const alias of framework.aliases) {
      if (!bucket.includes(alias)) {
        bucket.push(alias);
      }
    }
  }
  return result;
}

/**
 * Given a factory alias (e.g. "New" or "e"), look up which framework owns
 * it. Used by callers that need to know which framework matched (e.g. for
 * Vide's events-as-props handling).
 */
export function findFrameworkForAlias(
  alias: string
): FrameworkSpec | undefined {
  for (const framework of getEnabledFrameworks()) {
    if (framework.aliases.includes(alias)) {
      return framework;
    }
  }
  return undefined;
}
