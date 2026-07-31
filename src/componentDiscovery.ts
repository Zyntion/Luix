import * as path from "path";
import {
  ComponentReturnInfo,
  DocumentComponentInfo,
  DocumentModuleInfo,
} from "./parser";

export interface IndexedModuleFile {
  uriString: string;
  workspaceKey: string;
  relativeFile: string;
  components: Map<string, DocumentComponentInfo>;
  module: DocumentModuleInfo;
}

export interface DiscoveredComponent {
  name: string;
  uriString: string;
  info: DocumentComponentInfo;
  isFolderModule: boolean;
  modulePath: string;
  base?: string;
}

interface ModuleRecord {
  key: string;
  workspaceKey: string;
  uriString: string;
  modulePath: string;
  moduleSegments: string[];
  name: string;
  isFolderModule: boolean;
  file: IndexedModuleFile;
  info: DocumentComponentInfo;
}

const VIDE_DYNAMIC_UI_FUNCTIONS = new Set([
  "show",
  "switch",
  "indexes",
  "values",
]);

/**
 * Resolve exported UI modules to a fixed point. Direct factory returns and
 * explicit `@extends` annotations seed the graph; wrapper calls qualify only
 * after their require target is itself proven to be a component.
 */
export function discoverComponents(
  files: IndexedModuleFile[]
): DiscoveredComponent[] {
  const records = buildModuleRecords(files);
  const recordByKey = new Map<string, ModuleRecord>();
  for (const record of records) {
    recordByKey.set(record.key, record);
  }

  const resolved = new Set<string>();
  const resolvedBase = new Map<string, string | undefined>();
  for (const record of records) {
    const base =
      record.info.detectedBase ?? record.info.annotations.extendsClass;
    const localEvidence = inferLocalUi(
      record,
      record.info,
      new Set<string>()
    );
    if (base || localEvidence.isUi) {
      resolved.add(record.key);
      resolvedBase.set(
        record.key,
        base ??
          localEvidence.base
      );
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (resolved.has(record.key)) continue;
      const target = resolveReturnedComponent(
        record,
        record.info.uiReturn,
        records,
        recordByKey,
        resolved
      );
      if (!target) continue;
      resolved.add(record.key);
      resolvedBase.set(record.key, resolvedBase.get(target.key));
      changed = true;
    }
  }

  const out: DiscoveredComponent[] = [];
  for (const record of records) {
    if (!resolved.has(record.key)) continue;
    const base = resolvedBase.get(record.key);
    const info =
      base && !record.info.detectedBase
        ? { ...record.info, detectedBase: base }
        : record.info;
    out.push({
      name: record.name,
      uriString: record.uriString,
      info,
      isFolderModule: record.isFolderModule,
      modulePath: record.modulePath,
      base,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function buildModuleRecords(files: IndexedModuleFile[]): ModuleRecord[] {
  const out: ModuleRecord[] = [];
  for (const file of files) {
    const normalizedFile = file.relativeFile.replace(/\\/g, "/");
    if (/\.story\.lua(u)?$/i.test(path.posix.basename(normalizedFile))) {
      continue;
    }

    const isFolderModule = /(^|\/)init\.lua(u)?$/i.test(normalizedFile);
    const modulePath = isFolderModule
      ? normalizedFile.replace(/(^|\/)init\.lua(u)?$/i, "").replace(/\/$/, "")
      : normalizedFile.replace(/\.lua(u)?$/i, "");
    const moduleSegments = modulePath.split("/").filter(Boolean);
    const moduleName = moduleSegments[moduleSegments.length - 1];
    if (!moduleName) continue;

    let info: DocumentComponentInfo | undefined;
    if (file.module.exportedName) {
      info = file.components.get(file.module.exportedName);
    } else if (file.module.anonymousExport) {
      info = { ...file.module.anonymousExport, name: moduleName };
    }
    if (!info) continue;
    const name =
      isFolderModule || !file.module.exportedName
        ? moduleName
        : info.name;

    out.push({
      key: `${file.workspaceKey}|${modulePath.toLowerCase()}`,
      workspaceKey: file.workspaceKey,
      uriString: file.uriString,
      modulePath,
      moduleSegments,
      name,
      isFolderModule,
      file,
      info,
    });
  }
  return out;
}

function inferLocalUi(
  record: ModuleRecord,
  info: DocumentComponentInfo,
  visiting: Set<string>
): { isUi: boolean; base?: string } {
  const base = info.detectedBase ?? info.annotations.extendsClass;
  if (base) {
    return { isUi: true, base };
  }
  if (info.uiReturn?.kind === "factory") {
    return { isUi: true, base: info.uiReturn.base };
  }
  if (!info.uiReturn) {
    return { isUi: false };
  }

  const callees =
    info.uiReturn.kind === "call"
      ? [info.uiReturn.callee]
      : info.uiReturn.callees;
  for (const callee of callees) {
    if (isVideDynamicCallee(record, callee)) {
      return { isUi: true };
    }
    if (
      callee.includes(".") ||
      record.file.module.requireBindings.has(callee) ||
      visiting.has(callee)
    ) {
      continue;
    }
    const local = record.file.components.get(callee);
    if (!local) {
      continue;
    }
    visiting.add(callee);
    const localEvidence = inferLocalUi(record, local, visiting);
    visiting.delete(callee);
    if (localEvidence.isUi) {
      return localEvidence;
    }
  }
  return { isUi: false };
}

function isVideDynamicCallee(
  record: ModuleRecord,
  callee: string
): boolean {
  const parts = callee.split(".");
  if (parts.length < 2) return false;
  const member = parts[parts.length - 1];
  if (!VIDE_DYNAMIC_UI_FUNCTIONS.has(member)) return false;
  const root = parts[0];
  const required = record.file.module.requireBindings.get(root);
  return required !== undefined && /(?:^|\.)Vide\s*$/i.test(required);
}

function resolveReturnedComponent(
  record: ModuleRecord,
  returned: ComponentReturnInfo | undefined,
  records: ModuleRecord[],
  recordByKey: Map<string, ModuleRecord>,
  resolved: Set<string>
): ModuleRecord | undefined {
  if (!returned || returned.kind === "factory") return undefined;
  const callees = collectExternalCallees(
    record,
    returned,
    new Set<string>()
  );
  for (const callee of callees) {
    if (isVideDynamicCallee(record, callee)) continue;
    const rootBinding = callee.split(".")[0];
    const required = record.file.module.requireBindings.get(rootBinding);
    if (!required) continue;
    const target = resolveRequireTarget(
      record,
      required,
      records,
      recordByKey
    );
    if (target && resolved.has(target.key)) {
      return target;
    }
  }
  return undefined;
}

function collectExternalCallees(
  record: ModuleRecord,
  returned: ComponentReturnInfo,
  visiting: Set<string>
): string[] {
  if (returned.kind === "factory") {
    return [];
  }
  const out: string[] = [];
  const callees =
    returned.kind === "call" ? [returned.callee] : returned.callees;
  for (const callee of callees) {
    if (isVideDynamicCallee(record, callee)) {
      continue;
    }
    if (
      !callee.includes(".") &&
      !record.file.module.requireBindings.has(callee) &&
      !visiting.has(callee)
    ) {
      const local = record.file.components.get(callee);
      if (local?.uiReturn) {
        visiting.add(callee);
        out.push(
          ...collectExternalCallees(record, local.uiReturn, visiting)
        );
        visiting.delete(callee);
        continue;
      }
    }
    out.push(callee);
  }
  return out;
}

function resolveRequireTarget(
  from: ModuleRecord,
  expression: string,
  records: ModuleRecord[],
  recordByKey: Map<string, ModuleRecord>
): ModuleRecord | undefined {
  const memberChain = expression.match(
    /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/
  )?.[0];
  if (!memberChain) return undefined;
  const expressionSegments = memberChain.split(".");

  if (expressionSegments[0].toLowerCase() === "script") {
    const targetSegments = [...from.moduleSegments];
    for (const segment of expressionSegments.slice(1)) {
      if (segment === "Parent") {
        targetSegments.pop();
      } else {
        targetSegments.push(segment);
      }
    }
    const key = `${from.workspaceKey}|${targetSegments
      .join("/")
      .toLowerCase()}`;
    return recordByKey.get(key);
  }

  const loweredExpression = expressionSegments.map((segment) =>
    segment.toLowerCase()
  );
  let best: ModuleRecord | undefined;
  let bestScore = 0;
  let tied = false;
  for (const candidate of records) {
    if (candidate.workspaceKey !== from.workspaceKey) continue;
    const candidateSegments = candidate.moduleSegments.map((segment) =>
      segment.toLowerCase()
    );
    const score = commonSuffixLength(
      loweredExpression,
      candidateSegments
    );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  }
  return bestScore >= 2 && !tied ? best : undefined;
}

function commonSuffixLength(a: string[], b: string[]): number {
  let count = 0;
  while (
    count < a.length &&
    count < b.length &&
    a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count++;
  }
  return count;
}
