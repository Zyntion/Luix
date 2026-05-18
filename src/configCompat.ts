import * as vscode from "vscode";

// All settings now live under `luix.*`. The previous rebrand kept a
// silent fallback to the legacy `reactLuauPropsHelper.*` prefix, but
// VS Code's `inspect()` returns `globalValue: undefined` when a
// user-set value happens to equal the package.json default (e.g.
// `"luix.props": {}`) — which made the fallback override the user's
// implicit intent in ambiguous cases. The fallback has been removed.
// Anyone still on the old keys needs to rename them in `settings.json`
// (or copy the block under `luix.*` instead).

const NEW_PREFIX = "luix";
const LEGACY_PREFIX = "reactLuauPropsHelper";

export function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace
    .getConfiguration(NEW_PREFIX)
    .get<T>(key, defaultValue);
}

/**
 * Returns true if the given setting *path* (e.g. `inlayHints.enabled`)
 * was changed under the `luix.*` prefix. Useful for
 * `onDidChangeConfiguration`.
 *
 * The legacy `reactLuauPropsHelper.*` prefix is also checked so the
 * UI refreshes when a user removes / edits stale entries — even though
 * we no longer *read* those values, a change there may mean the user
 * was migrating and added a `luix.*` entry too.
 */
export function configChangeAffects(
  event: vscode.ConfigurationChangeEvent,
  key: string
): boolean {
  return (
    event.affectsConfiguration(`${NEW_PREFIX}.${key}`) ||
    event.affectsConfiguration(`${LEGACY_PREFIX}.${key}`)
  );
}
