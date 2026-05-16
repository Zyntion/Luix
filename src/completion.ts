import * as vscode from "vscode";
import {
  ANNOTATION_TYPE_HINTS,
  PROP_TYPES,
  defaultPropsMap,
  flattenClassEvents,
  flattenClassProps,
  renderTypeSnippet,
} from "./data";
import {
  AliasPartition,
  findEnclosingPropsCall,
  pushUnique,
  scanDocument,
} from "./parser";
import {
  findFrameworkForAlias,
  getAliasPartition,
} from "./frameworks";
import { getConfig } from "./configCompat";
import { WorkspaceIndex } from "./workspaceIndex";

// ============================================================================
// Main completion provider — props inside e(...) tables + [React.Event.X]
// ============================================================================

export class ReactLuauPropsCompletionProvider
  implements vscode.CompletionItemProvider
{
  constructor(private readonly workspaceIndex: WorkspaceIndex) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const text = document.getText();
    const cursorOffset = document.offsetAt(position);

    // Fast-path: `[React.Event.|` and `[React.Change.|` inside a props
    // table. The cursor must be in an event/change-key slot for this to
    // fire — otherwise we fall through to normal prop completion.
    const lineText = document.lineAt(position.line).text;
    const before = lineText.slice(0, position.character);
    const eventMatch = /\[\s*React\.Event\.([A-Za-z_]\w*)?$/.exec(before);
    const changeMatch = /\[\s*React\.Change\.([A-Za-z_]\w*)?$/.exec(before);
    if (eventMatch || changeMatch) {
      const detected = findEnclosingPropsCall(
        text,
        cursorOffset,
        getAliasPartition()
      );
      if (!detected) {
        return undefined;
      }
      const baseClass = await resolveEffectiveClass(
        detected.className,
        document,
        this.workspaceIndex
      );
      if (!baseClass) {
        return undefined;
      }
      const names = eventMatch
        ? flattenClassEvents(baseClass)
        : flattenClassProps(baseClass);
      const wordRange = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_][A-Za-z0-9_]*/
      );
      return names.map((name, index) => {
        const item = new vscode.CompletionItem(
          name,
          eventMatch
            ? vscode.CompletionItemKind.Event
            : vscode.CompletionItemKind.Property
        );
        item.filterText = name;
        item.sortText = String(index).padStart(4, "0");
        item.detail = eventMatch
          ? `${baseClass} event`
          : `${baseClass} property (Change listener)`;
        if (wordRange) {
          item.range = wordRange;
        }
        return item;
      });
    }

    const detected = findEnclosingPropsCall(text, cursorOffset, getAliasPartition());
    if (!detected) {
      return undefined;
    }

    let props = await getPropsForClass(
      detected.className,
      document,
      this.workspaceIndex
    );
    if (!props || props.length === 0) {
      return undefined;
    }

    // Vide-style frameworks treat event handlers as plain table keys
    // (e.g. `Activated = function() … end`). Merge the events of the
    // resolved class into the suggestion list when the matched framework
    // opts in.
    if (detected.alias) {
      const framework = findFrameworkForAlias(detected.alias);
      if (framework?.eventsAsProps) {
        const baseClass = await resolveEffectiveClass(
          detected.className,
          document,
          this.workspaceIndex
        );
        if (baseClass) {
          const events = flattenClassEvents(baseClass);
          if (events.length > 0) {
            const merged: string[] = [];
            pushUnique(merged, props);
            pushUnique(merged, events);
            props = merged;
          }
        }
      }
    }

    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/
    );

    return buildItemsForProps(detected.className, props, wordRange);
  }
}

// ============================================================================
// Annotation completion — `---@extends X` and `---@prop NAME Type`
// ============================================================================

export class AnnotationCompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    const before = lineText.slice(0, position.character);

    const extendsMatch = /^\s*---\s*@extends\s+([A-Za-z_][A-Za-z0-9_.]*)?$/.exec(
      before
    );
    if (extendsMatch) {
      return this.classNameItems();
    }

    const propMatch =
      /^\s*---\s*@prop\s+[A-Za-z_][A-Za-z0-9_]*\s+([A-Za-z_][A-Za-z0-9_.?]*)?$/.exec(
        before
      );
    if (propMatch) {
      return this.typeNameItems();
    }

    return undefined;
  }

  private classNameItems(): vscode.CompletionItem[] {
    return Object.keys(defaultPropsMap)
      .sort()
      .map((name, index) => {
        const item = new vscode.CompletionItem(
          name,
          vscode.CompletionItemKind.Class
        );
        item.detail = "Roblox class";
        item.sortText = String(index).padStart(4, "0");
        return item;
      });
  }

  private typeNameItems(): vscode.CompletionItem[] {
    return ANNOTATION_TYPE_HINTS.map((name, index) => {
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.TypeParameter
      );
      item.detail = "Luau type";
      item.sortText = String(index).padStart(4, "0");
      return item;
    });
  }
}

// ============================================================================
// getPropsForClass — async resolver with extends chain + workspace fallback
// ============================================================================

export type UserPropsEntry =
  | string[]
  | { extends?: string; props?: string[] };

export async function getPropsForClass(
  className: string,
  document?: vscode.TextDocument,
  workspaceIndex?: WorkspaceIndex
): Promise<string[] | undefined> {
  const userMap = getConfig<Record<string, UserPropsEntry>>("props", {}) ?? {};
  const aliases = getAliasPartition();
  return resolveProps(
    className,
    userMap,
    document,
    workspaceIndex,
    aliases,
    new Set(),
    0
  );
}

async function resolveProps(
  className: string,
  userMap: Record<string, UserPropsEntry>,
  document: vscode.TextDocument | undefined,
  workspaceIndex: WorkspaceIndex | undefined,
  aliases: AliasPartition,
  visited: Set<string>,
  depth: number
): Promise<string[] | undefined> {
  if (depth > 8 || visited.has(className)) {
    return undefined;
  }
  visited.add(className);

  // 1. User config wins outright.
  if (Object.prototype.hasOwnProperty.call(userMap, className)) {
    return resolveUserEntry(
      userMap[className],
      userMap,
      document,
      workspaceIndex,
      aliases,
      visited,
      depth
    );
  }

  // 2. Built-in defaults win outright.
  if (defaultPropsMap[className]) {
    return defaultPropsMap[className];
  }

  // 3. Custom component: same-file inference first, then workspace-wide.
  let info = document
    ? scanDocument(document.getText(), aliases).get(className)
    : undefined;
  if (!info && workspaceIndex) {
    info = await workspaceIndex.findComponent(
      className,
      document?.uri.toString()
    );
  }
  if (!info) {
    return undefined;
  }

  const merged: string[] = [];
  pushUnique(merged, info.annotations.props);
  pushUnique(merged, info.paramTypeFields ?? []);
  const base = info.annotations.extendsClass ?? info.detectedBase;
  if (base) {
    const baseProps = await resolveProps(
      base,
      userMap,
      document,
      workspaceIndex,
      aliases,
      visited,
      depth + 1
    );
    if (baseProps) {
      pushUnique(merged, baseProps);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

async function resolveUserEntry(
  entry: UserPropsEntry,
  userMap: Record<string, UserPropsEntry>,
  document: vscode.TextDocument | undefined,
  workspaceIndex: WorkspaceIndex | undefined,
  aliases: AliasPartition,
  visited: Set<string>,
  depth: number
): Promise<string[] | undefined> {
  if (Array.isArray(entry)) {
    return entry.filter((x): x is string => typeof x === "string");
  }
  if (entry && typeof entry === "object") {
    const merged: string[] = [];
    if (Array.isArray(entry.props)) {
      pushUnique(
        merged,
        entry.props.filter((x): x is string => typeof x === "string")
      );
    }
    if (typeof entry.extends === "string") {
      const baseProps = await resolveProps(
        entry.extends,
        userMap,
        document,
        workspaceIndex,
        aliases,
        visited,
        depth + 1
      );
      if (baseProps) {
        pushUnique(merged, baseProps);
      }
    }
    return merged;
  }
  return undefined;
}

/**
 * Used by the Event/Change completion path: resolve a component name down
 * to the Roblox host class it ultimately extends.
 */
async function resolveEffectiveClass(
  className: string,
  document: vscode.TextDocument | undefined,
  workspaceIndex: WorkspaceIndex | undefined
): Promise<string | undefined> {
  if (defaultPropsMap[className]) {
    return className;
  }
  if (!document) {
    return undefined;
  }
  const aliases = getAliasPartition();
  let info = scanDocument(document.getText(), aliases).get(className);
  if (!info && workspaceIndex) {
    info = await workspaceIndex.findComponent(
      className,
      document.uri.toString()
    );
  }
  if (!info) {
    return undefined;
  }
  return info.annotations.extendsClass ?? info.detectedBase;
}

// ============================================================================
// CompletionItem builders
// ============================================================================

function buildItemsForProps(
  className: string,
  props: string[],
  range: vscode.Range | undefined
): vscode.CompletionItem[] {
  const snippetMode = getConfig<string>("snippetMode", "value-with-comma");
  const typeAware = getConfig<boolean>("typeAwareValues", true);

  return props.map((name, index) => {
    const item = new vscode.CompletionItem(
      name,
      vscode.CompletionItemKind.Property
    );
    const propType = typeAware ? PROP_TYPES[name] : undefined;
    item.insertText = buildSnippet(name, snippetMode, propType);
    item.detail = propType
      ? `${className} property — ${propType}`
      : `${className} property`;
    item.documentation = new vscode.MarkdownString(
      `\`${className}.${name}\`${
        propType ? ` — type \`${propType}\`` : ""
      } — suggested by React Luau Props Helper.`
    );
    item.filterText = name;
    item.sortText = String(index).padStart(4, "0");
    if (range) {
      item.range = range;
    }
    return item;
  });
}

function buildSnippet(
  name: string,
  mode: string,
  propType?: string
): vscode.SnippetString {
  const valueTemplate = propType ? renderTypeSnippet(propType) : undefined;

  switch (mode) {
    case "name-only":
      return new vscode.SnippetString(name);
    case "value":
      if (valueTemplate) {
        return new vscode.SnippetString(`${name} = ${valueTemplate}$0`);
      }
      return new vscode.SnippetString(`${name} = $0`);
    case "value-with-comma":
    default:
      if (valueTemplate) {
        return new vscode.SnippetString(`${name} = ${valueTemplate},$0`);
      }
      return new vscode.SnippetString(`${name} = $1,$0`);
  }
}
