import * as vscode from "vscode";
import {
  ReactLuauPropsCompletionProvider,
  AnnotationCompletionProvider,
} from "./completion";
import {
  Color3DocumentColorProvider,
  PropHoverProvider,
  CreateElementInlayHintsProvider,
  CreateElementSymbolProvider,
} from "./editor";
import { DiagnosticsManager } from "./diagnostics";
import {
  AutoImportCodeActionProvider,
  DeprecationCodeActionProvider,
  buildRelativePath,
  resolveViaAlias,
} from "./codeActions";
import { WorkspaceIndex } from "./workspaceIndex";
import {
  DEFAULT_ALIASES,
  PROP_TYPES,
  TYPE_SNIPPETS,
  buildFontFaceReplacement,
  classHierarchy,
  defaultPropsMap,
  findIntroducingClass,
  flattenClassEvents,
  flattenClassProps,
  renderTypeSnippet,
} from "./data";
import { collectLocalBindings } from "./parser";
import { PaletteCompletionProvider } from "./palette";
import {
  ComponentsTreeProvider,
  WorkspaceTreeProvider,
} from "./sidebar";
import {
  generateRojoSourcemap,
  regenerateWallyTypes,
  wallyInstall,
} from "./wally";
import { pickFrameworkAndScaffold, scaffoldComponent } from "./scaffolds";

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: "lua", scheme: "file" },
    { language: "luau", scheme: "file" },
  ];

  const workspaceIndex = new WorkspaceIndex();
  context.subscriptions.push(workspaceIndex);

  // Props provider — only `.` as a trigger character (needed for
  // `[React.Event.|` and `[React.Change.|` completion). Space/newline are
  // deliberately *not* triggers; that would steal Tab from GitHub
  // Copilot's inline ghost text.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new ReactLuauPropsCompletionProvider(workspaceIndex),
      "."
    )
  );

  // Annotation provider — completes `---@extends <Class>` and
  // `---@prop NAME <Type>`. Only fires inside `---` comment lines.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new AnnotationCompletionProvider(),
      " "
    )
  );

  // Color preview — gutter swatches and VS Code's colour picker.
  context.subscriptions.push(
    vscode.languages.registerColorProvider(
      selector,
      new Color3DocumentColorProvider()
    )
  );

  // Hover docs — prop type, inherited-from class, Roblox docs link.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new PropHoverProvider())
  );

  // Inlay hints — labels at the closing `)` of every multi-line
  // createElement call.
  const inlayHints = new CreateElementInlayHintsProvider();
  context.subscriptions.push(
    inlayHints,
    vscode.languages.registerInlayHintsProvider(selector, inlayHints)
  );

  // Document symbols — Outline panel, breadcrumbs, Go to Symbol.
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      selector,
      new CreateElementSymbolProvider()
    )
  );

  // Diagnostics — reserved-name, deprecations, opt-in missing imports.
  const diagnostics = new DiagnosticsManager(workspaceIndex);
  context.subscriptions.push(diagnostics);

  // Code actions — Font → FontFace, TextColor → TextColor3, auto-import.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new DeprecationCodeActionProvider(),
      {
        providedCodeActionKinds:
          DeprecationCodeActionProvider.providedCodeActionKinds,
      }
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new AutoImportCodeActionProvider(workspaceIndex),
      {
        providedCodeActionKinds:
          AutoImportCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Palette completion — triggers on `.` and only fires when the cursor
  // is right after `Color3.`.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new PaletteCompletionProvider(),
      "."
    )
  );

  // ---- Sidebar (Workspace + Components views) ----
  const workspaceTreeProvider = new WorkspaceTreeProvider();
  const componentsTreeProvider = new ComponentsTreeProvider(
    workspaceIndex,
    context
  );
  // Seed the context key so the title-bar toggle shows the right icon.
  void vscode.commands.executeCommand(
    "setContext",
    "luix.componentsViewMode",
    componentsTreeProvider.getMode()
  );
  context.subscriptions.push(
    workspaceTreeProvider,
    componentsTreeProvider,
    vscode.window.registerTreeDataProvider(
      "luix.workspace",
      workspaceTreeProvider
    ),
    vscode.window.registerTreeDataProvider(
      "luix.components",
      componentsTreeProvider
    )
  );

  // ---- Commands wired up by the sidebar entries ----
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "luix.wally.regenerateTypes",
      regenerateWallyTypes
    ),
    vscode.commands.registerCommand("luix.wally.install", wallyInstall),
    vscode.commands.registerCommand(
      "luix.rojo.generateSourcemap",
      generateRojoSourcemap
    ),
    vscode.commands.registerCommand(
      "luix.newComponent.react",
      (uri?: vscode.Uri) => scaffoldComponent("react", uri)
    ),
    vscode.commands.registerCommand(
      "luix.newComponent.fusion",
      (uri?: vscode.Uri) => scaffoldComponent("fusion", uri)
    ),
    vscode.commands.registerCommand(
      "luix.newComponent.vide",
      (uri?: vscode.Uri) => scaffoldComponent("vide", uri)
    ),
    vscode.commands.registerCommand(
      "luix.newComponentHere",
      (uri?: vscode.Uri) => pickFrameworkAndScaffold(uri)
    ),
    vscode.commands.registerCommand("luix.refreshComponents", () =>
      componentsTreeProvider.refresh()
    ),
    vscode.commands.registerCommand("luix.refreshWorkspace", () =>
      workspaceTreeProvider.refresh()
    ),
    vscode.commands.registerCommand("luix.componentsView.toggleMode", () =>
      componentsTreeProvider.toggleMode()
    )
  );
}

export function deactivate() {}

// ============================================================================
// Re-exports for tests
// ============================================================================
//
// The test file imports from `../extension`. To keep tests unchanged after
// the refactor, re-export each helper/type from its new home.

export {
  buildCodeMask,
  applyMask,
  findEnclosingPropsCall,
  extractTypeFields,
  parseAnnotationsForComponent,
  scanDocument,
  detectReturnedClass,
  findAllCreateElementCalls,
  buildCallTree,
  extractColorLiterals,
  collectLocalBindings,
} from "./parser";

export type {
  EnclosingCall,
  ComponentAnnotations,
  DocumentComponentInfo,
  CreateElementCall,
  CallTreeNode,
  ColorLiteral,
} from "./parser";

export const _internal = {
  defaultPropsMap,
  DEFAULT_ALIASES,
};

export const _testing = {
  PROP_TYPES,
  TYPE_SNIPPETS,
  renderTypeSnippet,
  classHierarchy,
  flattenClassProps,
  flattenClassEvents,
  findIntroducingClass,
  buildFontFaceReplacement,
  collectLocalBindings,
  buildRelativePath,
  resolveViaAlias,
};
