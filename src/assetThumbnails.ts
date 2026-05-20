import * as vscode from "vscode";
import { getConfig } from "./configCompat";

// ============================================================================
// Roblox asset thumbnail helpers — shared by the hover provider and the
// gutter decorator
// ============================================================================
//
// Two layers of caching, with deliberately different lifetimes:
//
//   1. In-memory `thumbnailUrlCache` — maps `assetId` → resolved CDN
//      URL, for the *hover* path. The hover renders the image directly
//      from the CDN URL through VS Code's markdown image loader, so it
//      never touches disk. 24h TTL on success, 1 min on failure.
//
//   2. On-disk PNG cache, for the *gutter icon* path. VS Code's
//      `gutterIconPath` requires a local file URI (remote URLs aren't
//      supported), so we download each thumbnail once and write it
//      somewhere the decorator can point to.
//
// The on-disk cache lives in one of two places, picked by
// `luix.imageGutter.cacheLocation`:
//
//   • `global` (default) — `<extension globalStorage>/assetThumbs/`.
//     Shared across every workspace, never touches the user's repo.
//   • `workspace` — `<workspace>/.luix/assetThumbs/`. Self-contained per
//     project. A `.luix/.gitignore` is auto-written so the cache
//     doesn't leak into commits.

/**
 * Size requested from the thumbnails API. 150×150 is the sweet spot:
 *   - Big enough to be legible in the hover popup with no scroll.
 *   - Small enough that the file cache stays under a few KB per asset.
 *   - Looks crisp scaled down to the ~16px gutter icon.
 */
const THUMBNAIL_SIZE = "150x150" as const;

interface CachedUrl {
  url: string | null;
  expires: number;
}
const thumbnailUrlCache = new Map<string, CachedUrl>();
const THUMBNAIL_TTL_OK = 24 * 60 * 60 * 1000;
const THUMBNAIL_TTL_FAIL = 60 * 1000;

/**
 * Resolve a Roblox asset ID to the actual CDN image URL via the public
 * thumbnails API. Returns null when the asset is moderated, deleted, or
 * the API is unreachable. Memoised for the session.
 */
export async function fetchAssetThumbnailUrl(
  assetId: string,
  size: string = THUMBNAIL_SIZE
): Promise<string | null> {
  const cacheKey = `${assetId}@${size}`;
  const now = Date.now();
  const cached = thumbnailUrlCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.url;
  }
  const url =
    `https://thumbnails.roblox.com/v1/assets` +
    `?assetIds=${assetId}&size=${size}&format=Png&isCircular=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      thumbnailUrlCache.set(cacheKey, {
        url: null,
        expires: now + THUMBNAIL_TTL_FAIL,
      });
      return null;
    }
    const payload = (await res.json()) as {
      data?: Array<{ state?: string; imageUrl?: string | null }>;
    };
    const entry = payload?.data?.[0];
    if (entry?.state === "Completed" && entry.imageUrl) {
      thumbnailUrlCache.set(cacheKey, {
        url: entry.imageUrl,
        expires: now + THUMBNAIL_TTL_OK,
      });
      return entry.imageUrl;
    }
    thumbnailUrlCache.set(cacheKey, {
      url: null,
      expires: now + THUMBNAIL_TTL_FAIL,
    });
    return null;
  } catch {
    thumbnailUrlCache.set(cacheKey, {
      url: null,
      expires: now + THUMBNAIL_TTL_FAIL,
    });
    return null;
  }
}

/**
 * Resolve the directory where on-disk thumbnails should live. Honours
 * `luix.imageGutter.cacheLocation` and falls back to global storage
 * when "workspace" is requested but no workspace is open.
 */
export function getThumbnailCacheDir(
  context: vscode.ExtensionContext
): vscode.Uri {
  const location = getConfig<string>("imageGutter.cacheLocation", "global");
  if (location === "workspace") {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      return vscode.Uri.joinPath(folder.uri, ".luix", "assetThumbs");
    }
  }
  return vscode.Uri.joinPath(context.globalStorageUri, "assetThumbs");
}

/**
 * Every cache directory that has ever been used for this extension —
 * resolved location *plus* the global fallback. Used by `purge` and
 * `getCacheStats` so flipping the location setting doesn't leave a
 * second directory dangling.
 */
function allKnownCacheDirs(
  context: vscode.ExtensionContext
): vscode.Uri[] {
  const out: vscode.Uri[] = [
    vscode.Uri.joinPath(context.globalStorageUri, "assetThumbs"),
  ];
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    out.push(vscode.Uri.joinPath(folder.uri, ".luix", "assetThumbs"));
  }
  return out;
}

/**
 * Ensure the thumbnail PNG for `assetId` exists on disk; download it
 * if not. Returns the local file URI suitable for `gutterIconPath`,
 * or undefined if the network/API call failed.
 */
export async function ensureThumbnailFile(
  context: vscode.ExtensionContext,
  assetId: string
): Promise<vscode.Uri | undefined> {
  const cacheDir = getThumbnailCacheDir(context);
  const filePath = vscode.Uri.joinPath(cacheDir, `${assetId}.png`);
  try {
    await vscode.workspace.fs.stat(filePath);
    return filePath;
  } catch {
    // Not cached yet — fall through to download.
  }
  const cdnUrl = await fetchAssetThumbnailUrl(assetId);
  if (!cdnUrl) {
    return undefined;
  }
  try {
    const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return undefined;
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    await ensureCacheDirReady(cacheDir);
    await vscode.workspace.fs.writeFile(filePath, buffer);
    return filePath;
  } catch {
    return undefined;
  }
}

/**
 * Create the cache directory if missing. When the cache lives inside
 * the workspace, also drop a `.gitignore` next to it so the cache
 * doesn't leak into commits.
 */
async function ensureCacheDirReady(cacheDir: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(cacheDir);
  } catch {
    // Already exists — fine.
  }
  // The cache dir is `<…>/.luix/assetThumbs` — the gitignore goes one
  // level up so the whole `.luix/` folder is ignored.
  if (!cacheDir.path.includes("/.luix/")) {
    return;
  }
  const parent = vscode.Uri.joinPath(cacheDir, "..");
  const gitignore = vscode.Uri.joinPath(parent, ".gitignore");
  try {
    await vscode.workspace.fs.stat(gitignore);
    return; // already there
  } catch {
    // Need to write it.
  }
  try {
    await vscode.workspace.fs.writeFile(
      gitignore,
      new TextEncoder().encode(
        "# Auto-written by the Luix Roblox extension.\n" +
          "# Caches Roblox asset thumbnails for the inline image previews.\n" +
          "# Safe to ignore — they re-download on demand.\n" +
          "*\n"
      )
    );
  } catch {
    // Best-effort.
  }
}

/**
 * Tally up every PNG across the active cache and the global fallback
 * so the sidebar can display "N assets, X MB" honestly even if the
 * user flipped between cache locations.
 */
export async function getCacheStats(
  context: vscode.ExtensionContext
): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const dir of allKnownCacheDirs(context)) {
    let entries: Array<[string, vscode.FileType]> = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      continue;
    }
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      if (!name.endsWith(".png")) continue;
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(dir, name)
        );
        count++;
        bytes += stat.size;
      } catch {
        // Ignore individual stat failures.
      }
    }
  }
  return { count, bytes };
}

/**
 * Delete every cached thumbnail across both possible locations. Safe
 * to call when the cache is empty or the directories don't exist —
 * the call is idempotent.
 */
export async function purgeAllThumbnails(
  context: vscode.ExtensionContext
): Promise<void> {
  for (const dir of allKnownCacheDirs(context)) {
    try {
      await vscode.workspace.fs.delete(dir, {
        recursive: true,
        useTrash: false,
      });
    } catch {
      // Directory may not exist — fine.
    }
  }
}

/** Extract every distinct asset ID referenced anywhere in the document. */
export function findAssetReferences(
  text: string
): Array<{ assetId: string; offset: number }> {
  const out: Array<{ assetId: string; offset: number }> = [];
  // Match `rbxassetid://NNNN` or `rbxasset://NNNN` inside any quote
  // style (`"…"`, `'…'`, Luau backticks). The thumbnails API treats both
  // prefixes the same; users sometimes type one and sometimes the other.
  const re = /(["'`])rbxasset(?:id)?:\/\/(\d+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ assetId: m[2], offset: m.index });
  }
  return out;
}
