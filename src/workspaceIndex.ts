import * as vscode from "vscode";
import { configChangeAffects, getConfig } from "./configCompat";
import { getAliasPartition } from "./frameworks";
import {
  CreateElementCall,
  findAllCreateElementCalls,
  scanDocument,
  DocumentComponentInfo,
} from "./parser";

/**
 * Directories Luix always skips when indexing the workspace. These are
 * the conventional homes of vendored / third-party Roblox code; the
 * user's own UI components live elsewhere.
 *
 *   - `Packages` / `DevPackages` / `ServerPackages` — Wally's package
 *     output directories.
 *   - `_Index` — Wally's internal package store under `Packages/`.
 *   - `node_modules` / `out` / `dist` — JS / build artifacts.
 *
 * Users can extend this list via `luix.exclude`.
 */
const DEFAULT_EXCLUDED_DIRS = [
  "Packages",
  "DevPackages",
  "ServerPackages",
  "_Index",
  "node_modules",
  "out",
  "dist",
];

function getExcludedDirs(): string[] {
  const extra = getConfig<string[]>("exclude", []) ?? [];
  return [...DEFAULT_EXCLUDED_DIRS, ...extra];
}

function isExcluded(uri: vscode.Uri, excludedDirs: string[]): boolean {
  const segments = uri.fsPath.split(/[/\\]/);
  for (const seg of segments) {
    if (excludedDirs.includes(seg)) {
      return true;
    }
  }
  return false;
}

function buildExcludeGlob(excludedDirs: string[]): string {
  if (excludedDirs.length === 0) {
    return "";
  }
  // `**/{Packages,DevPackages,...}/**` matches every file under any of
  // the named directories at any depth.
  return `**/{${excludedDirs.join(",")}}/**`;
}

/**
 * Conservative check for whether a `DocumentComponentInfo` describes
 * something that's actually a UI component (vs. a utility function the
 * parser also picked up). At least one strong signal must be present:
 *
 *   - The function returns an element call (`detectedBase` set), OR
 *   - It carries an explicit `---@extends ClassName` annotation.
 *
 * The annotated-but-no-extends case (e.g. only `---@prop name type`
 * lines) is intentionally excluded — that pattern shows up on
 * non-component helpers too.
 */
function looksLikeComponent(info: DocumentComponentInfo): boolean {
  if (info.detectedBase) {
    return true;
  }
  if (info.annotations.extendsClass) {
    return true;
  }
  return false;
}

/**
 * Workspace-wide component index. Scans every `.lua`/`.luau` file in the
 * project once, then keeps itself fresh via the file-system watcher and the
 * onDidChangeTextDocument event (so unsaved buffers are reflected).
 *
 * Files under Wally / vendored directories are skipped — see
 * `DEFAULT_EXCLUDED_DIRS` above.
 *
 * Lookups are name-based: the first matching component in the index wins.
 * If multiple files declare a component with the same identifier, this is
 * a best-effort guess (cross-file `require` resolution would be needed for
 * full precision and is a documented limitation).
 */
export class WorkspaceIndex implements vscode.Disposable {
  private cache = new Map<
    string,
    {
      components: Map<string, DocumentComponentInfo>;
      /** Every component call site in the file, keyed by the last
       *  segment of the called name (`Components.Button` → `Button`).
       *  Used by the "N references" CodeLens. */
      callSites: Map<string, CreateElementCall[]>;
    }
  >();
  private warmupPromise: Promise<void>;
  private disposables: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  private _changeTimer: NodeJS.Timeout | undefined;
  /** Fires after the index reaches a new steady state — used by the
   *  Components sidebar to refresh. Debounced so a burst of keystrokes
   *  doesn't rebuild the tree dozens of times per second. */
  readonly onDidChangeIndex: vscode.Event<void> = this._onDidChange.event;

  /** Coalesce rapid scan calls into a single fire (200ms). */
  private scheduleChange(): void {
    if (this._changeTimer) {
      clearTimeout(this._changeTimer);
    }
    this._changeTimer = setTimeout(() => {
      this._changeTimer = undefined;
      this._onDidChange.fire();
    }, 200);
  }

  constructor() {
    this.warmupPromise = this.warmup().catch(() => {});

    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{lua,luau}"
    );
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => {
        this.scanUri(uri).catch(() => {});
      }),
      watcher.onDidCreate((uri) => {
        this.scanUri(uri).catch(() => {});
      }),
      watcher.onDidDelete((uri) => {
        if (this.cache.delete(uri.toString())) {
          this.scheduleChange();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const langId = e.document.languageId;
        if (langId !== "lua" && langId !== "luau") {
          return;
        }
        if (isExcluded(e.document.uri, getExcludedDirs())) {
          return;
        }
        this.scanDocument(e.document);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          configChangeAffects(e, "createElementAliases") ||
          configChangeAffects(e, "frameworks") ||
          configChangeAffects(e, "react.aliases") ||
          configChangeAffects(e, "roact.aliases") ||
          configChangeAffects(e, "fusion.aliases") ||
          configChangeAffects(e, "vide.aliases") ||
          configChangeAffects(e, "exclude")
        ) {
          this.cache.clear();
          this.warmupPromise = this.warmup().catch(() => {});
          this.scheduleChange();
        }
      })
    );
  }

  private async warmup(): Promise<void> {
    const excludedDirs = getExcludedDirs();
    const excludeGlob = buildExcludeGlob(excludedDirs);
    const files = await vscode.workspace.findFiles(
      "**/*.{lua,luau}",
      excludeGlob || null
    );
    await Promise.all(
      files.map((uri) => this.scanUri(uri).catch(() => undefined))
    );
  }

  private async scanUri(uri: vscode.Uri): Promise<void> {
    if (isExcluded(uri, getExcludedDirs())) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    this.scanDocument(doc);
  }

  private scanDocument(doc: vscode.TextDocument): void {
    const aliases = getAliasPartition();
    const text = doc.getText();
    const components = scanDocument(text, aliases);
    const callSites = new Map<string, CreateElementCall[]>();
    for (const call of findAllCreateElementCalls(text, aliases)) {
      if (call.isStringLiteralName) {
        continue;
      }
      const key = call.className.split(".").pop() ?? call.className;
      const list = callSites.get(key);
      if (list) {
        list.push(call);
      } else {
        callSites.set(key, [call]);
      }
    }
    this.cache.set(doc.uri.toString(), { components, callSites });
    this.scheduleChange();
  }

  /**
   * Returns every component currently in the index, alphabetised by
   * name. Only functions that actually look like UI components are
   * included — see `looksLikeComponent` for the rule. Helper functions
   * that happen to take a `props` parameter but never return an element
   * are filtered out.
   */
  async getAllComponents(): Promise<
    Array<{ name: string; uri: vscode.Uri; info: DocumentComponentInfo }>
  > {
    await this.warmupPromise;
    const out: Array<{
      name: string;
      uri: vscode.Uri;
      info: DocumentComponentInfo;
    }> = [];
    for (const [uriString, entry] of this.cache) {
      for (const [name, info] of entry.components) {
        if (!looksLikeComponent(info)) {
          continue;
        }
        out.push({ name, uri: vscode.Uri.parse(uriString), info });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /**
   * Returns the first match for `componentName` across the workspace,
   * preferring files other than `excludeUri` (typically the file the user
   * is editing — its own contents have already been searched by the
   * same-file inference pass).
   */
  async findComponent(
    componentName: string,
    excludeUri?: string
  ): Promise<DocumentComponentInfo | undefined> {
    await this.warmupPromise;
    for (const [uriString, entry] of this.cache) {
      if (uriString === excludeUri) {
        continue;
      }
      const found = entry.components.get(componentName);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Like findComponent, but returns the URI of the defining file alongside
   * the parsed info. Used by auto-import to locate the file to import from.
   */
  async findComponentFile(
    componentName: string,
    excludeUri?: string
  ): Promise<{ uri: vscode.Uri; info: DocumentComponentInfo } | undefined> {
    await this.warmupPromise;
    const lastSegment = componentName.split(".").pop() ?? componentName;
    for (const [uriString, entry] of this.cache) {
      if (uriString === excludeUri) {
        continue;
      }
      const found = entry.components.get(lastSegment);
      if (found) {
        return { uri: vscode.Uri.parse(uriString), info: found };
      }
    }
    return undefined;
  }

  /**
   * Locate every call site of a component across the indexed workspace,
   * returned as `{ uri, range }` pairs that the CodeLens provider can
   * surface as references. Self-calls inside the defining file are
   * included.
   */
  async findCallSites(
    componentName: string
  ): Promise<Array<{ uri: vscode.Uri; range: vscode.Range }>> {
    await this.warmupPromise;
    const key = componentName.split(".").pop() ?? componentName;
    const out: Array<{ uri: vscode.Uri; range: vscode.Range }> = [];
    for (const [uriString, entry] of this.cache) {
      const hits = entry.callSites.get(key);
      if (!hits) continue;
      let doc: vscode.TextDocument | undefined;
      try {
        doc = await vscode.workspace.openTextDocument(
          vscode.Uri.parse(uriString)
        );
      } catch {
        continue;
      }
      for (const call of hits) {
        out.push({
          uri: doc.uri,
          range: new vscode.Range(
            doc.positionAt(call.classNameStart),
            doc.positionAt(call.classNameEnd)
          ),
        });
      }
    }
    return out;
  }

  /**
   * For tests: directly seed the cache with parsed component info.
   */
  _seedForTesting(
    entries: Array<[string, Map<string, DocumentComponentInfo>]>
  ): void {
    for (const [uriString, components] of entries) {
      this.cache.set(uriString, {
        components,
        callSites: new Map(),
      });
    }
    this.warmupPromise = Promise.resolve();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    if (this._changeTimer) {
      clearTimeout(this._changeTimer);
      this._changeTimer = undefined;
    }
    this._onDidChange.dispose();
  }
}

/**
 * Exported for unit tests.
 */
export const _internal = {
  isExcluded,
  DEFAULT_EXCLUDED_DIRS,
  buildExcludeGlob,
};
