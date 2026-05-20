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
interface CacheEntry {
  components: Map<string, DocumentComponentInfo>;
  /** Every component call site in the file, keyed by the last segment
   *  of the called name (`Components.Button` → `Button`). Used by the
   *  "N references" CodeLens. */
  callSites: Map<string, CreateElementCall[]>;
  /** mtime + size fingerprint used by the on-disk cache to decide
   *  whether a file needs re-parsing on cold start. */
  fingerprint?: { mtime: number; size: number };
}

export class WorkspaceIndex implements vscode.Disposable {
  private cache = new Map<string, CacheEntry>();
  private warmupPromise: Promise<void>;
  private disposables: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  private _changeTimer: NodeJS.Timeout | undefined;
  private _persistTimer: NodeJS.Timeout | undefined;
  private _scanTimers = new Map<string, NodeJS.Timeout>();
  private context: vscode.ExtensionContext | undefined;
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

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
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
        const key = e.document.uri.toString();
        const existing = this._scanTimers.get(key);
        if (existing) {
          clearTimeout(existing);
        }
        this._scanTimers.set(
          key,
          setTimeout(() => {
            this._scanTimers.delete(key);
            this.scanDocument(e.document);
          }, 200)
        );
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
    // Restore persisted cache (if any) before scanning so unchanged
    // files can be re-used without re-parsing. The persist file is
    // versioned + workspace-scoped; a mismatch silently falls back to
    // a full rescan.
    const persistEnabled =
      getConfig<boolean>("indexPersistence.enabled", true) &&
      this.context !== undefined;
    if (persistEnabled) {
      await this.loadPersistedCache().catch(() => {});
    }
    const files = await vscode.workspace.findFiles(
      "**/*.{lua,luau}",
      excludeGlob || null
    );
    await Promise.all(
      files.map((uri) => this.scanUri(uri).catch(() => undefined))
    );
    if (persistEnabled) {
      this.schedulePersist();
    }
  }

  private async scanUri(uri: vscode.Uri): Promise<void> {
    if (isExcluded(uri, getExcludedDirs())) {
      return;
    }
    // Skip re-parsing if the persisted cache entry matches the file's
    // current size + mtime.
    const cached = this.cache.get(uri.toString());
    if (cached?.fingerprint) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (
          stat.mtime === cached.fingerprint.mtime &&
          stat.size === cached.fingerprint.size
        ) {
          return;
        }
      } catch {
        // File no longer exists — clear cache entry, fall through to
        // the normal failure handling.
        this.cache.delete(uri.toString());
        return;
      }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    this.scanDocument(doc);
    // Stamp the fresh fingerprint so subsequent cold-starts can skip.
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const entry = this.cache.get(uri.toString());
      if (entry) {
        entry.fingerprint = { mtime: stat.mtime, size: stat.size };
      }
    } catch {
      // Best-effort.
    }
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
    // Preserve any existing fingerprint — the caller (`scanUri`)
    // refreshes it after writing the entry.
    const existing = this.cache.get(doc.uri.toString());
    this.cache.set(doc.uri.toString(), {
      components,
      callSites,
      fingerprint: existing?.fingerprint,
    });
    this.scheduleChange();
    this.schedulePersist();
  }

  // ---- Persistence ------------------------------------------------------

  private schedulePersist(): void {
    if (!this.context) return;
    if (!getConfig<boolean>("indexPersistence.enabled", true)) return;
    if (this._persistTimer) clearTimeout(this._persistTimer);
    // 5s after the last change — avoids hammering disk during edits.
    this._persistTimer = setTimeout(() => {
      this._persistTimer = undefined;
      void this.persistNow().catch(() => {});
    }, 5000);
  }

  private async persistNow(): Promise<void> {
    if (!this.context) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const file = persistFileFor(this.context, folder);
    const data = serialiseCache(this.cache);
    try {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(file, "..")
      );
    } catch {
      // exists — fine.
    }
    await vscode.workspace.fs.writeFile(
      file,
      new TextEncoder().encode(JSON.stringify(data))
    );
  }

  private async loadPersistedCache(): Promise<void> {
    if (!this.context) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const file = persistFileFor(this.context, folder);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(file);
    } catch {
      return; // No prior cache.
    }
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes)) as PersistedCache;
      if (data.version !== PERSIST_VERSION) {
        return;
      }
      for (const [uriStr, entry] of Object.entries(data.files)) {
        this.cache.set(uriStr, deserialiseEntry(entry));
      }
    } catch {
      // Corrupt JSON — silently ignore, full rescan happens anyway.
    }
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
    for (const t of this._scanTimers.values()) {
      clearTimeout(t);
    }
    this._scanTimers.clear();
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

// ============================================================================
// Persistence support
// ============================================================================
//
// The persisted cache lives in the extension's global storage, keyed by
// a hash of the workspace path. Bump `PERSIST_VERSION` whenever the
// serialised structure changes; older caches are silently discarded on
// load.

const PERSIST_VERSION = 1;

interface PersistedCache {
  version: number;
  files: Record<string, PersistedFileEntry>;
}
interface PersistedFileEntry {
  fingerprint?: { mtime: number; size: number };
  components: Array<[string, PersistedComponentInfo]>;
  callSites: Array<[string, CreateElementCall[]]>;
}
interface PersistedComponentInfo {
  name: string;
  defLineIndex: number;
  paramTypeFields?: string[];
  annotations: { extendsClass?: string; props: string[] };
  detectedBase?: string;
  hardcodedProps?: string[];
}

function persistFileFor(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder
): vscode.Uri {
  // Tag the cache file by a short hash of the workspace path so
  // separate projects don't clobber each other.
  const path = folder.uri.fsPath;
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = (h * 31 + path.charCodeAt(i)) | 0;
  }
  const tag = (h >>> 0).toString(36);
  return vscode.Uri.joinPath(
    context.globalStorageUri,
    "workspaceIndex",
    `${tag}.json`
  );
}

function serialiseCache(
  cache: Map<string, CacheEntry>
): PersistedCache {
  const files: Record<string, PersistedFileEntry> = {};
  for (const [uri, entry] of cache) {
    const components: Array<[string, PersistedComponentInfo]> = [];
    for (const [name, info] of entry.components) {
      components.push([
        name,
        {
          name: info.name,
          defLineIndex: info.defLineIndex,
          paramTypeFields: info.paramTypeFields,
          annotations: {
            extendsClass: info.annotations.extendsClass,
            props: info.annotations.props,
          },
          detectedBase: info.detectedBase,
          hardcodedProps: info.hardcodedProps
            ? Array.from(info.hardcodedProps)
            : undefined,
        },
      ]);
    }
    files[uri] = {
      fingerprint: entry.fingerprint,
      components,
      callSites: Array.from(entry.callSites.entries()),
    };
  }
  return { version: PERSIST_VERSION, files };
}

function deserialiseEntry(entry: PersistedFileEntry): CacheEntry {
  const components = new Map<string, DocumentComponentInfo>();
  for (const [name, info] of entry.components) {
    components.set(name, {
      name: info.name,
      defLineIndex: info.defLineIndex,
      paramTypeFields: info.paramTypeFields,
      annotations: {
        extendsClass: info.annotations.extendsClass,
        props: info.annotations.props,
      },
      detectedBase: info.detectedBase,
      hardcodedProps: info.hardcodedProps
        ? new Set(info.hardcodedProps)
        : undefined,
    });
  }
  return {
    components,
    callSites: new Map(entry.callSites),
    fingerprint: entry.fingerprint,
  };
}
