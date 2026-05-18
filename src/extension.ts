import * as vscode from "vscode";
import {
  AnnotationCompletionProvider,
  ClassNameCompletionProvider,
  FactoryOpenParenCompletionProvider,
  ReactLuauPropsCompletionProvider,
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
  Color3ConvertCodeActionProvider,
  Color3PaletteExtractorProvider,
  DeprecationCodeActionProvider,
  UDim2ConvertCodeActionProvider,
  WrapInCodeActionProvider,
  buildRelativePath,
  resolveViaAlias,
} from "./codeActions";
import { AnchorPresetCompletionProvider } from "./anchorPresets";
import {
  ComponentReferencesLensProvider,
  FrameStatsLensProvider,
} from "./codeLens";
import { maybeAugmentFromApiDump } from "./apiDump";
import { WorkspaceValidation } from "./workspaceValidation";
import {
  FontsCompletionProvider,
  SpacingCompletionProvider,
} from "./palette";
import { extractToComponentCommand } from "./extractComponent";
import { ImageGutterDecorator } from "./imageGutter";
import {
  getCacheStats,
  getThumbnailCacheDir,
  purgeAllThumbnails,
} from "./assetThumbnails";
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
  FontFamilyCompletionProvider,
  FontWeightCompletionProvider,
} from "./robloxFonts";
import {
  RichTextColorProvider,
  RichTextCompletionProvider,
  registerRichTextAutoClose,
} from "./richText";
import {
  RobloxGlyphCompletionProvider,
  RobloxGlyphHoverProvider,
  RobloxGlyphInlayHintsProvider,
} from "./robloxGlyphs";
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

  const workspaceIndex = new WorkspaceIndex(context);

  // Kick off the optional Roblox API-dump fetch (no-op when the
  // setting is off — see `apiDump.ts`).
  maybeAugmentFromApiDump(context);
  context.subscriptions.push(workspaceIndex);

  // Props provider — `.` is needed for `[React.Event.|` and
  // `[React.Change.|`; `{` makes the suggestion list open the moment you
  // type the props brace so common props (`Name`, `Size`, …) appear
  // without an extra Ctrl+Space. Space/newline are deliberately *not*
  // triggers; that would steal Tab from GitHub Copilot's inline ghost text.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new ReactLuauPropsCompletionProvider(workspaceIndex),
      ".",
      "{"
    )
  );

  // Class-name provider — fires inside the string-literal first arg of a
  // factory call (`e("Fr|"`, `New "Fr|"`, …). Trigger chars are the
  // quotes themselves so the list opens the instant the user types `e("`.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new ClassNameCompletionProvider(),
      '"',
      "'"
    )
  );
  // Optional companion: fire the class picker on `(` so typing `e(`
  // opens the list without needing to also type the opening quote.
  // Off by default — many users won't want the trigger to fire on
  // every function call. Suppression handled inside the provider.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FactoryOpenParenCompletionProvider(),
      "("
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

  // Color preview — gutter swatches and VS Code's color picker.
  context.subscriptions.push(
    vscode.languages.registerColorProvider(
      selector,
      new Color3DocumentColorProvider()
    )
  );

  // Hover docs — prop type, inherited-from class, Roblox docs link; also
  // surfaces a "what is this custom component?" tooltip on the class slot
  // of `e(MyButton, …)` style calls.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      selector,
      new PropHoverProvider(workspaceIndex)
    )
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
  // Convert Color3 between fromRGB / fromHex / new / fromHSV.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new Color3ConvertCodeActionProvider(),
      {
        providedCodeActionKinds:
          Color3ConvertCodeActionProvider.providedCodeActionKinds,
      }
    )
  );
  // Convert UDim2 between new / fromOffset / fromScale.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new UDim2ConvertCodeActionProvider(),
      {
        providedCodeActionKinds:
          UDim2ConvertCodeActionProvider.providedCodeActionKinds,
      }
    )
  );
  // Wrap selection in Frame / ScrollingFrame / container w/ UIListLayout.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new WrapInCodeActionProvider(),
      {
        providedCodeActionKinds:
          WrapInCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // `anchor:tl|t|tr|l|c|r|bl|b|br` typed completion inside props tables.
  // Trigger char `:` overlaps with the Roblox-glyph completion (which only
  // fires inside strings) — both providers context-check and return
  // undefined when they aren't relevant.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new AnchorPresetCompletionProvider(),
      ":"
    )
  );

  // "N references" CodeLens above every component definition.
  const referencesLens = new ComponentReferencesLensProvider(workspaceIndex);
  context.subscriptions.push(
    referencesLens,
    vscode.languages.registerCodeLensProvider(selector, referencesLens)
  );
  // Frame-stats CodeLens — `▸ N descendants, D layers` above heavy
  // subtrees. Off by default (visual noise).
  const frameStatsLens = new FrameStatsLensProvider();
  context.subscriptions.push(
    frameStatsLens,
    vscode.languages.registerCodeLensProvider(selector, frameStatsLens)
  );
  // Color3-to-palette extractor — code action on any Color3 literal.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new Color3PaletteExtractorProvider(),
      {
        providedCodeActionKinds:
          Color3PaletteExtractorProvider.providedCodeActionKinds,
      }
    )
  );

  // Workspace-wide diagnostic aggregator. The summary surfaces through
  // the sidebar; the provider does nothing while disabled.
  const workspaceValidation = new WorkspaceValidation();
  context.subscriptions.push(workspaceValidation);

  // Gutter image previews next to `Image = "rbxassetid://..."` lines —
  // downloads and caches a tiny thumbnail per asset under the
  // extension's global storage (or `.luix/assetThumbs/` when the user
  // has opted in to workspace-local caching).
  const imageGutter = new ImageGutterDecorator(context);
  context.subscriptions.push(imageGutter);

  // Palette completion — triggers on `.` and only fires when the cursor
  // is right after `Color3.`.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new PaletteCompletionProvider(),
      "."
    )
  );
  // Design-token completion — `luix.spacing` shows after `UDim.`,
  // `luix.fonts` after `Font.`. Both empty by default — opt-in via
  // user config.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new SpacingCompletionProvider(),
      "."
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FontsCompletionProvider(),
      "."
    )
  );

  // Roblox font catalogue — family names inside `Font.fromName("…")`,
  // weight names after `Enum.FontWeight.`, filtered by the active
  // family when we can detect it from the surrounding call.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FontFamilyCompletionProvider(),
      '"',
      "'",
      "`"
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new FontWeightCompletionProvider(),
      "."
    )
  );

  // RichText completion — `<` inside any single-line string surfaces the
  // Roblox tag list (`<b>`, `<font ...>`, `<stroke ...>`, …). The snippet
  // also inserts the matching close tag. Paired with an auto-close handler
  // so typing the `>` of an opening tag (`<font size="18">`) drops in the
  // matching `</font>` after the cursor. Both gated by `luix.richText.enabled`.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new RichTextCompletionProvider(),
      "<"
    )
  );
  context.subscriptions.push(
    vscode.languages.registerColorProvider(
      selector,
      new RichTextColorProvider()
    )
  );
  registerRichTextAutoClose(context);

  // Roblox private-use-area glyph support — Robux / Premium / Verified /
  // Roblox Plus render as missing-glyph boxes in VS Code's default fonts.
  // Inlay hints name each occurrence; the hover gives codepoint + Luau
  // escape; the `:slug:` completion lets users insert the literal glyph
  // from inside a string. All gated by `luix.robloxGlyphs.enabled`.
  const robloxGlyphHints = new RobloxGlyphInlayHintsProvider();
  context.subscriptions.push(
    robloxGlyphHints,
    vscode.languages.registerInlayHintsProvider(selector, robloxGlyphHints),
    vscode.languages.registerHoverProvider(
      selector,
      new RobloxGlyphHoverProvider()
    ),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new RobloxGlyphCompletionProvider(),
      ":"
    )
  );

  // ---- Sidebar (Workspace + Components views) ----
  const workspaceTreeProvider = new WorkspaceTreeProvider(
    context,
    workspaceValidation
  );
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
    ),
    vscode.commands.registerCommand(
      "luix.extractToComponent",
      extractToComponentCommand
    ),
    vscode.commands.registerCommand(
      "luix.imageGutter.purgeCache",
      async () => {
        const { count } = await getCacheStats(context);
        if (count === 0) {
          void vscode.window.showInformationMessage(
            "Luix: image preview cache is already empty."
          );
          return;
        }
        const choice = await vscode.window.showWarningMessage(
          `Purge ${count} cached Roblox asset thumbnail${count === 1 ? "" : "s"}? They'll re-download on demand.`,
          { modal: true },
          "Purge"
        );
        if (choice !== "Purge") return;
        await purgeAllThumbnails(context);
        imageGutter.clearAllDecorations();
        workspaceTreeProvider.refreshCache();
        void vscode.window.showInformationMessage(
          "Luix: image preview cache purged."
        );
      }
    ),
    vscode.commands.registerCommand(
      "luix.imageGutter.enableFromSidebar",
      async () => {
        await vscode.workspace
          .getConfiguration("luix")
          .update(
            "imageGutter.enabled",
            true,
            vscode.ConfigurationTarget.Global
          );
        // The sidebar entry IS the disclosure — suppress the
        // post-first-download notification so users don't get the
        // same message twice.
        await context.globalState.update(
          "luix.imageGutter.firstDownloadNotified",
          true
        );
        const choice = await vscode.window.showInformationMessage(
          "Luix: image gutter previews are now on. Thumbnails download once per asset and live under VS Code's extension storage by default — flip `luix.imageGutter.cacheLocation` to `workspace` if you'd rather they live in `.luix/assetThumbs/` per project.",
          "Open settings",
          "Got it"
        );
        if (choice === "Open settings") {
          void vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:ericplane.luix-roblox imageGutter"
          );
        }
      }
    ),
    vscode.commands.registerCommand(
      "luix.palette.addEntry",
      async (literal?: string) => {
        if (typeof literal !== "string") return;
        const name = await vscode.window.showInputBox({
          title: "Luix: save Color3 to palette",
          prompt:
            "Token name (e.g. `primary`, `surface`, `text`). The literal will be added to `luix.palette` so it surfaces in `Color3.` completions.",
          validateInput: (v) =>
            /^[A-Za-z_][A-Za-z0-9_-]*$/.test(v)
              ? undefined
              : "Use a simple identifier (letters/digits/dash/underscore).",
        });
        if (!name) return;
        const target = await vscode.window.showQuickPick(
          [
            { label: "User settings (global)", target: vscode.ConfigurationTarget.Global },
            { label: "Workspace settings", target: vscode.ConfigurationTarget.Workspace },
          ],
          { title: "Where should the palette entry live?" }
        );
        if (!target) return;
        const cfg = vscode.workspace.getConfiguration("luix");
        const current = cfg.get<Record<string, string>>("palette", {}) ?? {};
        if (current[name] && current[name] !== literal) {
          const overwrite = await vscode.window.showWarningMessage(
            `Luix: \`palette.${name}\` already exists with value \`${current[name]}\`. Overwrite?`,
            { modal: true },
            "Overwrite"
          );
          if (overwrite !== "Overwrite") return;
        }
        await cfg.update("palette", { ...current, [name]: literal }, target.target);
        void vscode.window.showInformationMessage(
          `Luix: added \`palette.${name}\` → \`${literal}\`.`
        );
      }
    ),
    vscode.commands.registerCommand(
      "luix.imageGutter.openCacheFolder",
      async () => {
        const dir = getThumbnailCacheDir(context);
        try {
          await vscode.workspace.fs.stat(dir);
        } catch {
          void vscode.window.showInformationMessage(
            `Luix: cache directory \`${dir.fsPath}\` doesn't exist yet — view a file with an asset reference first.`
          );
          return;
        }
        await vscode.commands.executeCommand(
          "revealFileInOS",
          dir
        );
      }
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
  extractPropEntries,
  findEnclosingFactoryStringArg,
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
  EnclosingStringArg,
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
