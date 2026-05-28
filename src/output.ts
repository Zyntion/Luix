import * as vscode from "vscode";

// ============================================================================
// Luix output channel — best-effort logging for silent-failure paths
// ============================================================================
//
// Created lazily on first use, registered into the extension's disposables
// from `extension.ts::activate`. Callers should keep messages short and
// actionable — this is for diagnosability when a Luix feature quietly
// returns `undefined` (asset thumbnail fetch errored, API-dump download
// failed, persist write rejected, …), not for user-facing errors.

let _channel: vscode.OutputChannel | undefined;

/** Get (lazily creating) the shared "Luix" output channel. */
export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("Luix");
  }
  return _channel;
}

/** Log a one-line warning to the Luix output channel. No-op if VS Code
 *  APIs aren't available (test bootstrap). */
export function logWarn(message: string, err?: unknown): void {
  try {
    const channel = getOutputChannel();
    const stamp = new Date().toISOString().slice(11, 19);
    const errSuffix =
      err === undefined
        ? ""
        : err instanceof Error
          ? ` — ${err.name}: ${err.message}`
          : ` — ${String(err)}`;
    channel.appendLine(`[${stamp}] ${message}${errSuffix}`);
  } catch {
    // VS Code unavailable; nothing to log to.
  }
}

/** Returns the lazily-created channel disposable for registration in
 *  extension `subscriptions`. Safe to call before first log. */
export function getOutputChannelDisposable(): vscode.Disposable {
  return getOutputChannel();
}
