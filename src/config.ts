import { getConfig } from "./configCompat";
import { getAliasPartition } from "./frameworks";

/**
 * Returns the flat union of all enabled aliases regardless of call shape.
 * Most internal code now prefers `getAliasPartition()` to know which
 * call form each alias uses; this helper exists for the legacy
 * `createElementAliases` user override and for tests.
 */
export function getAliases(): string[] {
  const partition = getAliasPartition();
  const combined = [...partition.parens, ...partition.curried];
  // The legacy `createElementAliases` setting still wins if set.
  const fromConfig = getConfig<string[]>("createElementAliases", combined);
  if (!Array.isArray(fromConfig) || fromConfig.length === 0) {
    return combined;
  }
  return fromConfig;
}

export interface AutoImportAlias {
  filesystemPath: string;
  robloxPath: string;
}

export interface AutoImportConfig {
  enabled: boolean;
  style: "relative" | "alias";
  aliases: AutoImportAlias[];
}

export function getAutoImportConfig(): AutoImportConfig {
  return {
    enabled: getConfig<boolean>("autoImport.enabled", false),
    style: getConfig<"relative" | "alias">(
      "autoImport.style",
      "relative"
    ),
    aliases: getConfig<AutoImportAlias[]>("autoImport.aliases", []) ?? [],
  };
}
