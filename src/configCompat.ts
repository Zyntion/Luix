import * as vscode from "vscode";

// VS Code config compatibility shim for the rebrand. Settings have moved
// from `reactLuauPropsHelper.*` to `luix.*`. We still fall back to the
// legacy prefix silently so any user who hasn't migrated their
// `settings.json` keeps their behaviour, but the previous nag-on-startup
// notification has been removed.

const NEW_PREFIX = "luix";
const LEGACY_PREFIX = "reactLuauPropsHelper";

/**
 * Get a setting value. Reads `luix.<key>` first; if that key is not
 * *explicitly* set by the user (only the default applies), falls back to
 * `reactLuauPropsHelper.<key>`.
 */
export function getConfig<T>(key: string, defaultValue: T): T {
  const newCfg = vscode.workspace.getConfiguration(NEW_PREFIX);
  const newInspect = newCfg.inspect<T>(key);
  if (
    newInspect &&
    (newInspect.globalValue !== undefined ||
      newInspect.workspaceValue !== undefined ||
      newInspect.workspaceFolderValue !== undefined)
  ) {
    return newCfg.get<T>(key, defaultValue);
  }

  const legacyCfg = vscode.workspace.getConfiguration(LEGACY_PREFIX);
  const legacyInspect = legacyCfg.inspect<T>(key);
  if (
    legacyInspect &&
    (legacyInspect.globalValue !== undefined ||
      legacyInspect.workspaceValue !== undefined ||
      legacyInspect.workspaceFolderValue !== undefined)
  ) {
    return legacyCfg.get<T>(key, defaultValue);
  }

  // Neither prefix has an explicit value; use the default we were given.
  return defaultValue;
}

/**
 * Returns true if the given setting *path* (e.g. `inlayHints.enabled`)
 * was changed in either prefix. Useful for `onDidChangeConfiguration`.
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
