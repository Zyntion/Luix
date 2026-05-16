import * as vscode from "vscode";

// VS Code config compatibility shim for the rebrand. Settings have moved
// from `reactLuauPropsHelper.*` to `luix.*`. We read both for one major
// version so existing users don't notice a regression, with the new key
// always winning when explicitly set.

const NEW_PREFIX = "luix";
const LEGACY_PREFIX = "reactLuauPropsHelper";

let legacyWarningShown = false;

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
    showLegacyWarningOnce();
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

function showLegacyWarningOnce(): void {
  if (legacyWarningShown) {
    return;
  }
  legacyWarningShown = true;
  const suppress = vscode.workspace
    .getConfiguration(NEW_PREFIX)
    .get<boolean>("suppressLegacySettingsWarning", false);
  if (suppress) {
    return;
  }
  void vscode.window
    .showInformationMessage(
      "Luix: detected legacy `reactLuauPropsHelper.*` settings. They still work, but please migrate to the `luix.*` prefix when you have a moment.",
      "Open settings",
      "Don't show again"
    )
    .then((choice) => {
      if (choice === "Open settings") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:ericplane.luix"
        );
      } else if (choice === "Don't show again") {
        void vscode.workspace
          .getConfiguration(NEW_PREFIX)
          .update(
            "suppressLegacySettingsWarning",
            true,
            vscode.ConfigurationTarget.Global
          );
      }
    });
}
