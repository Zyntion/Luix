import * as vscode from "vscode";

const TERMINAL_NAME = "Luix";

function runInTerminal(command: string): void {
  const existing = vscode.window.terminals.find(
    (t) => t.name === TERMINAL_NAME
  );
  const terminal = existing ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show(true);
  terminal.sendText(command, true);
}

function shellName(): string {
  return vscode.env.shell?.toLowerCase() ?? "";
}

/**
 * Windows PowerShell 5.1 (powershell.exe) — the shell that ships with
 * Windows — does not accept `&&` as a statement separator. PowerShell 7+
 * (pwsh.exe), cmd.exe, and POSIX shells all do.
 */
function isWindowsPowerShell5(): boolean {
  const s = shellName();
  return s.endsWith("\\powershell.exe") || s.endsWith("/powershell.exe");
}

function isAnyPowerShell(): boolean {
  const s = shellName();
  return (
    s.endsWith("powershell.exe") ||
    s.endsWith("pwsh.exe") ||
    s.endsWith("/pwsh") ||
    s === "pwsh"
  );
}

function isWindowsCmd(): boolean {
  const s = shellName();
  return s.endsWith("\\cmd.exe") || s.endsWith("/cmd.exe");
}

/**
 * A sleep command in the current shell's syntax. cmd.exe has no sub-second
 * sleep so we round up to whole seconds.
 */
function sleepCommand(ms: number): string {
  if (isAnyPowerShell()) {
    return `Start-Sleep -Milliseconds ${ms}`;
  }
  if (isWindowsCmd()) {
    const sec = Math.max(1, Math.round(ms / 1000));
    return `timeout /t ${sec} /nobreak >nul`;
  }
  return `sleep ${(ms / 1000).toFixed(2)}`;
}

/**
 * Chain commands so the next one only runs if the previous succeeded.
 * Works on Windows PowerShell 5.1, PowerShell 7+, cmd.exe, and POSIX shells.
 */
function chain(commands: string[]): string {
  if (isWindowsPowerShell5()) {
    return commands.reduceRight((tail, head) =>
      tail ? `${head}; if ($?) { ${tail} }` : head
    );
  }
  return commands.join(" && ");
}

/**
 * Find the project file Rojo uses. Most projects ship one called
 * `default.project.json`; we accept any `*.project.json` and prefer the
 * default when present.
 */
async function detectProjectFile(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const defaultUri = vscode.Uri.joinPath(folder.uri, "default.project.json");
  try {
    await vscode.workspace.fs.stat(defaultUri);
    return "default.project.json";
  } catch {
    // fall through
  }
  const matches = await vscode.workspace.findFiles(
    "*.project.json",
    "**/node_modules/**",
    1
  );
  if (matches.length === 0) {
    return undefined;
  }
  const path = require("path") as typeof import("path");
  return path.basename(matches[0].fsPath);
}

async function detectWallyToml(): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return false;
  }
  try {
    await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(folder.uri, "wally.toml")
    );
    return true;
  } catch {
    return false;
  }
}

export async function wallyInstall(): Promise<void> {
  if (!(await detectWallyToml())) {
    void vscode.window.showWarningMessage(
      "Luix: no wally.toml found in the workspace root."
    );
    return;
  }
  runInTerminal("wally install");
}

export async function generateRojoSourcemap(): Promise<void> {
  const projectFile = await detectProjectFile();
  if (!projectFile) {
    void vscode.window.showWarningMessage(
      "Luix: no *.project.json found in the workspace root."
    );
    return;
  }
  runInTerminal(`rojo sourcemap ${projectFile} -o sourcemap.json`);
}

export async function regenerateWallyTypes(): Promise<void> {
  if (!(await detectWallyToml())) {
    void vscode.window.showWarningMessage(
      "Luix: no wally.toml found in the workspace root."
    );
    return;
  }
  const projectFile = await detectProjectFile();
  if (!projectFile) {
    void vscode.window.showWarningMessage(
      "Luix: no *.project.json found — Rojo sourcemap is required for `wally-package-types`."
    );
    return;
  }
  runInTerminal(
    chain([
      "wally install",
      // Give Windows Defender a moment to release the freshly-written
      // top-level link files; otherwise rojo's sourcemap may miss them
      // and `wally-package-types` reports "Linker node … not found in
      // sourcemap" for each one. ~1.5s matches the multi-second gaps
      // a hand-typed sequence comfortably exceeds.
      sleepCommand(1500),
      `rojo sourcemap ${projectFile} -o sourcemap.json`,
      "wally-package-types --sourcemap sourcemap.json Packages/",
    ])
  );
}

/**
 * Used by the sidebar to decide which entries to show. Exposed so the
 * tree provider can refresh when these files appear/disappear.
 */
export interface WorkspaceCapabilities {
  hasWally: boolean;
  hasRojoProject: boolean;
}

export async function detectWorkspaceCapabilities(): Promise<WorkspaceCapabilities> {
  return {
    hasWally: await detectWallyToml(),
    hasRojoProject: (await detectProjectFile()) !== undefined,
  };
}
