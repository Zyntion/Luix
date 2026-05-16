// Pure parsing helpers — no `vscode` imports, all input/output is plain
// strings/objects. Everything here is unit-testable in isolation.

// ============================================================================
// Public types
// ============================================================================

export interface EnclosingCall {
  className: string;
  isStringLiteralName: boolean;
  /** Which factory alias matched (`e`, `New`, `create`, …). Lets callers
   *  look up the framework. */
  alias?: string;
  /** Whether the matched call was the parens or curried form. */
  callShape?: "parens" | "curried";
}

export interface ComponentAnnotations {
  extendsClass?: string;
  props: string[];
}

export interface DocumentComponentInfo {
  name: string;
  defLineIndex: number;
  paramTypeFields?: string[];
  annotations: ComponentAnnotations;
  detectedBase?: string;
}

export interface CreateElementCall {
  className: string;
  isStringLiteralName: boolean;
  nameProp?: string;
  aliasStart: number;
  fullEnd: number;
  classNameStart: number;
  classNameEnd: number;
  childrenStart?: number;
  childrenEnd?: number;
}

export interface CallTreeNode {
  call: CreateElementCall;
  children: CallTreeNode[];
}

export interface ColorLiteral {
  r: number;
  g: number;
  b: number;
  start: number;
  end: number;
}

/**
 * Aliases partitioned by call shape. `parens` aliases are used in the
 * React/Roact form (`f("X", { … })`); `curried` aliases use Lua's sugar
 * (`f "X" { … }`) as in Fusion / Vide.
 */
export interface AliasPartition {
  parens: string[];
  curried: string[];
}

function asPartition(aliases: AliasPartition | string[]): AliasPartition {
  if (Array.isArray(aliases)) {
    return { parens: aliases, curried: [] };
  }
  return aliases;
}

// ============================================================================
// String/comment masking
// ============================================================================

const LUA_BLOCK_OPENERS = new Set(["function", "if", "do", "repeat"]);
const LUA_BLOCK_CLOSERS = new Set(["end", "until"]);

// Combined cache for the mask + masked text. Every provider that touches a
// document needs at least one of these, so caching both per text saves a
// surprising amount of work — `findAllCreateElementCalls` and
// `findEnclosingPropsCall` and `scanDocument` and `extractColorLiterals`
// would otherwise each rebuild the mask from scratch.
interface MaskedDoc {
  mask: boolean[];
  masked: string;
}

const maskedDocCache: Array<{ text: string; entry: MaskedDoc }> = [];
const MASKED_DOC_CACHE_MAX = 4;

function getMaskedDoc(text: string): MaskedDoc {
  for (let i = maskedDocCache.length - 1; i >= 0; i--) {
    if (maskedDocCache[i].text === text) {
      // LRU bump: move to end so most-recent stays warm.
      const hit = maskedDocCache.splice(i, 1)[0];
      maskedDocCache.push(hit);
      return hit.entry;
    }
  }
  const mask = buildCodeMaskImpl(text);
  const masked = applyMaskImpl(text, mask);
  maskedDocCache.push({ text, entry: { mask, masked } });
  if (maskedDocCache.length > MASKED_DOC_CACHE_MAX) {
    maskedDocCache.shift();
  }
  return { mask, masked };
}

/**
 * Build a per-character bitmap where `true` means the character is *code*
 * (not inside a Lua string or comment). Quotes/comment delimiters are kept
 * as code so that downstream regexes can still see them.
 *
 * Cached: repeated calls with the same `text` return the same array
 * reference. Callers must treat the returned array as immutable.
 */
export function buildCodeMask(text: string): boolean[] {
  return getMaskedDoc(text).mask;
}

function buildCodeMaskImpl(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(true);
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    // Comments: `--`, `--[[ ... ]]`, `--[=*[ ... ]=*]`
    if (c === "-" && text[i + 1] === "-") {
      const blockMatch = /^\[(=*)\[/.exec(text.slice(i + 2));
      if (blockMatch) {
        const level = blockMatch[1].length;
        const closeStr = "]" + "=".repeat(level) + "]";
        const searchFrom = i + 2 + blockMatch[0].length;
        const closeIdx = text.indexOf(closeStr, searchFrom);
        const endIdx = closeIdx === -1 ? text.length : closeIdx + closeStr.length;
        for (let j = i; j < endIdx; j++) {
          mask[j] = false;
        }
        i = endIdx;
        continue;
      }
      while (i < text.length && text[i] !== "\n") {
        mask[i] = false;
        i++;
      }
      continue;
    }

    // Quoted strings: keep the quotes as code so a later regex can spot
    // them; mask the interior only.
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length) {
        if (text[i] === "\\" && i + 1 < text.length) {
          mask[i] = false;
          if (text[i + 1] !== "\n") {
            mask[i + 1] = false;
          }
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        if (text[i] === "\n") {
          // Unterminated string: stop masking at end-of-line.
          break;
        }
        mask[i] = false;
        i++;
      }
      continue;
    }

    // Long-bracket strings: `[[ ... ]]` / `[=*[ ... ]=*]`. Keep delimiters as
    // code; mask only the interior.
    if (c === "[") {
      const longMatch = /^\[(=*)\[/.exec(text.slice(i));
      if (longMatch) {
        const level = longMatch[1].length;
        const closeStr = "]" + "=".repeat(level) + "]";
        const innerStart = i + longMatch[0].length;
        const closeIdx = text.indexOf(closeStr, innerStart);
        const innerEnd = closeIdx === -1 ? text.length : closeIdx;
        for (let j = innerStart; j < innerEnd; j++) {
          mask[j] = false;
        }
        i = closeIdx === -1 ? text.length : closeIdx + closeStr.length;
        continue;
      }
    }

    i++;
  }

  return mask;
}

/**
 * Apply a code mask to a text, replacing non-code characters with spaces
 * (newlines preserved). When the mask was produced by `buildCodeMask(text)`
 * with the same `text`, the result is cached — callers should pass the
 * pair together to take advantage of that.
 */
export function applyMask(text: string, mask: boolean[]): string {
  // Fast path: if the mask is the one our cache built for this text, the
  // masked version is already cached too.
  for (let i = maskedDocCache.length - 1; i >= 0; i--) {
    if (
      maskedDocCache[i].text === text &&
      maskedDocCache[i].entry.mask === mask
    ) {
      return maskedDocCache[i].entry.masked;
    }
  }
  return applyMaskImpl(text, mask);
}

function applyMaskImpl(text: string, mask: boolean[]): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (mask[i]) {
      out.push(text[i]);
    } else {
      out.push(text[i] === "\n" ? "\n" : " ");
    }
  }
  return out.join("");
}

export function lineNumberOf(text: string, offset: number): number {
  let line = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text[i] === "\n") {
      line++;
    }
  }
  return line;
}

// ============================================================================
// Shared regex helpers
// ============================================================================

const aliasAlternationCache = new Map<string, string>();

export function buildAliasAlternation(aliases: string[]): string {
  const key = aliases.join("|");
  const hit = aliasAlternationCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  // Longest first so multi-segment names like `React.createElement` win over
  // bare `createElement` during alternation.
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  const result = sorted.map(escapeRegex).join("|");
  aliasAlternationCache.set(key, result);
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+*?^$()[\]{}|\\]/g, "\\$&");
}

// ============================================================================
// findEnclosingPropsCall — used by the completion + hover providers
// ============================================================================

/**
 * Walk backward from the cursor to find the `{` of the immediately enclosing
 * block. If that block opens a createElement-style props table, return the
 * class/component name. Otherwise return undefined.
 */
export function findEnclosingPropsCall(
  text: string,
  cursorIndex: number,
  aliases: AliasPartition | string[]
): EnclosingCall | undefined {
  const partition = asPartition(aliases);
  const mask = buildCodeMask(text);

  let braceDepth = 0;
  let parenDepth = 0;
  let openBraceIdx = -1;

  for (let i = cursorIndex - 1; i >= 0; i--) {
    if (!mask[i]) {
      continue;
    }
    const c = text[i];
    if (c === "}") {
      braceDepth++;
    } else if (c === "{") {
      if (braceDepth === 0) {
        // If we're inside an unmatched `(`, the cursor is in an expression,
        // not directly in the props object — skip.
        if (parenDepth < 0) {
          return undefined;
        }
        openBraceIdx = i;
        break;
      }
      braceDepth--;
    } else if (c === ")") {
      parenDepth++;
    } else if (c === "(") {
      parenDepth--;
    }
  }

  if (openBraceIdx === -1) {
    return undefined;
  }

  const sliceStart = Math.max(0, openBraceIdx - 500);
  const before = text.slice(sliceStart, openBraceIdx);

  // 1) Try parens form: FUNC(ARG, $
  if (partition.parens.length > 0) {
    const aliasPattern = buildAliasAlternation(partition.parens);
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9_.])(${aliasPattern})\\s*\\(\\s*` +
        `(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|` +
        `([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*))` +
        `\\s*,\\s*$`
    );
    const match = pattern.exec(before);
    if (match) {
      const alias = match[1];
      const dq = match[2];
      const sq = match[3];
      const id = match[4];
      const name = dq || sq || id;
      if (name) {
        return {
          className: name,
          isStringLiteralName: !!(dq || sq),
          alias,
          callShape: "parens",
        };
      }
    }
  }

  // 2) Try curried form: FUNC "ARG" $    (no comma, no second paren)
  if (partition.curried.length > 0) {
    const aliasPattern = buildAliasAlternation(partition.curried);
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9_.])(${aliasPattern})\\s+` +
        `(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|` +
        `([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*))` +
        `\\s*$`
    );
    const match = pattern.exec(before);
    if (match) {
      const alias = match[1];
      const dq = match[2];
      const sq = match[3];
      const id = match[4];
      const name = dq || sq || id;
      if (name) {
        return {
          className: name,
          isStringLiteralName: !!(dq || sq),
          alias,
          callShape: "curried",
        };
      }
    }
  }

  return undefined;
}

// ============================================================================
// Component scanning (function definitions + annotations + type aliases)
// ============================================================================

/**
 * Extract top-level field names from the body of a Luau type literal.
 * Input is the text INSIDE the outermost `{...}` (without those braces).
 * Skips index signatures (`[K]: V`) and ignores fields nested inside `{}`,
 * `()`, or `<>`.
 */
export function extractTypeFields(literalBody: string): string[] {
  const masked = applyMask(literalBody, buildCodeMask(literalBody));
  const fields: string[] = [];
  let i = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let angleDepth = 0;
  let expectingFieldName = true;

  while (i < masked.length) {
    const c = masked[i];

    if (c === "{") {
      braceDepth++;
      expectingFieldName = false;
      i++;
      continue;
    }
    if (c === "}") {
      braceDepth--;
      i++;
      continue;
    }
    if (c === "(") {
      parenDepth++;
      expectingFieldName = false;
      i++;
      continue;
    }
    if (c === ")") {
      parenDepth--;
      i++;
      continue;
    }
    if (c === "<") {
      angleDepth++;
      expectingFieldName = false;
      i++;
      continue;
    }
    if (c === ">") {
      if (angleDepth > 0) {
        angleDepth--;
      }
      i++;
      continue;
    }

    const atTopLevel =
      braceDepth === 0 && parenDepth === 0 && angleDepth === 0;

    if (atTopLevel) {
      if (c === "," || c === ";") {
        expectingFieldName = true;
        i++;
        continue;
      }
      if (c === "[") {
        let depth = 1;
        i++;
        while (i < masked.length && depth > 0) {
          if (masked[i] === "[") {
            depth++;
          } else if (masked[i] === "]") {
            depth--;
          }
          i++;
        }
        expectingFieldName = false;
        continue;
      }
      if (expectingFieldName && /[A-Za-z_]/.test(c)) {
        const start = i;
        while (i < masked.length && /\w/.test(masked[i])) {
          i++;
        }
        const name = masked.slice(start, i);
        let j = i;
        while (j < masked.length && /\s/.test(masked[j])) {
          j++;
        }
        if (masked[j] === ":") {
          fields.push(name);
        }
        expectingFieldName = false;
        continue;
      }
    }

    i++;
  }

  return fields;
}

/**
 * Walk backward from `defLineIndex - 1` over consecutive `---` comment
 * lines and pull recognized directives.
 */
export function parseAnnotationsForComponent(
  text: string,
  defLineIndex: number
): ComponentAnnotations {
  const lines = text.split("\n");
  const result: ComponentAnnotations = { props: [] };
  const commentLines: string[] = [];

  for (let i = defLineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith("---")) {
      break;
    }
    commentLines.unshift(trimmed);
  }

  for (const line of commentLines) {
    const extendsMatch = /^---\s*@extends\s+([A-Za-z_][A-Za-z0-9_.]*)/.exec(
      line
    );
    if (extendsMatch) {
      result.extendsClass = extendsMatch[1];
      continue;
    }
    const propMatch = /^---\s*@prop\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (propMatch) {
      result.props.push(propMatch[1]);
      continue;
    }
  }

  return result;
}

function findMatchingEnd(masked: string, startIdx: number): number {
  let depth = 1;
  const tokenRe = /\b\w+\b/g;
  tokenRe.lastIndex = startIdx;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(masked)) !== null) {
    if (LUA_BLOCK_OPENERS.has(m[0])) {
      depth++;
    } else if (LUA_BLOCK_CLOSERS.has(m[0])) {
      depth--;
      if (depth === 0) {
        return m.index + m[0].length;
      }
    }
  }
  return masked.length;
}

function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Find the first `return ALIAS(CLASS, ...)` whose enclosing function is the
 * component (i.e. not inside a nested function literal). Conditional returns
 * inside `if`/`do`/`while`/`for`/`repeat` blocks still count.
 *
 * `maskedText` is used for token scanning (so braces inside strings/comments
 * don't trip us up), `originalText` is used for capturing the class name
 * (because masking blanks out string interiors).
 */
export function detectReturnedClass(
  originalText: string,
  maskedText: string,
  bodyStart: number,
  bodyEnd: number,
  aliases: AliasPartition | string[]
): string | undefined {
  const partition = asPartition(aliases);
  // Combined regex: try parens form OR curried form, both rooted right
  // after the `return` keyword. The two alternations are wrapped in a
  // non-capturing group, with the class-name capture groups inside each.
  const parts: string[] = [];
  if (partition.parens.length > 0) {
    const a = buildAliasAlternation(partition.parens);
    parts.push(
      `(?:${a})\\s*\\(\\s*(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*))`
    );
  }
  if (partition.curried.length > 0) {
    const a = buildAliasAlternation(partition.curried);
    parts.push(
      `(?:${a})\\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*))`
    );
  }
  if (parts.length === 0) {
    return undefined;
  }
  const returnAliasPattern = new RegExp(
    `^\\s*\\(?\\s*(?:${parts.join("|")})`
  );

  const stack: string[] = [];
  const tokenRe = /\b\w+\b/g;
  tokenRe.lastIndex = bodyStart;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(maskedText)) !== null) {
    if (m.index >= bodyEnd) {
      break;
    }
    const word = m[0];
    if (word === "function") {
      stack.push("fn");
    } else if (word === "if" || word === "do" || word === "repeat") {
      stack.push(word);
    } else if (word === "end" || word === "until") {
      stack.pop();
    } else if (word === "return") {
      const functionDepth = stack.reduce(
        (n, t) => n + (t === "fn" ? 1 : 0),
        0
      );
      if (functionDepth === 0) {
        const after = originalText.slice(m.index + word.length, bodyEnd);
        const r = returnAliasPattern.exec(after);
        if (r) {
          // Two alternation branches may contribute capture groups
          // (parens form: 1-3, curried form: 4-6). Take whichever
          // branch matched.
          const name = r[1] || r[2] || r[3] || r[4] || r[5] || r[6];
          if (name) {
            return name;
          }
        }
      }
    }
  }
  return undefined;
}

function collectTypeAliases(maskedText: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const re = /\btype\s+([A-Za-z_]\w*)\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(maskedText)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findMatchingBrace(maskedText, braceStart);
    if (braceEnd === -1) {
      continue;
    }
    const body = maskedText.slice(braceStart + 1, braceEnd);
    result.set(name, extractTypeFields(body));
  }
  return result;
}

interface FunctionDef {
  name: string;
  defIdx: number;
  paramType?: string;
  bodyStart: number;
  bodyEnd: number;
}

interface ParameterListInfo {
  firstParamType?: string;
  paramListEnd: number;
}

function parseParameterList(
  maskedText: string,
  openParenIdx: number
): ParameterListInfo | undefined {
  let i = openParenIdx + 1;
  let firstParamType: string | undefined;

  while (i < maskedText.length && /\s/.test(maskedText[i])) {
    i++;
  }

  const nameStart = i;
  while (i < maskedText.length && /\w/.test(maskedText[i])) {
    i++;
  }

  if (i > nameStart) {
    let j = i;
    while (j < maskedText.length && /\s/.test(maskedText[j])) {
      j++;
    }
    if (maskedText[j] === ":") {
      j++;
      while (j < maskedText.length && /\s/.test(maskedText[j])) {
        j++;
      }
      const typeStart = j;
      let typeEnd = j;
      let bDepth = 0;
      let pDepth = 0;
      let aDepth = 0;
      while (typeEnd < maskedText.length) {
        const c = maskedText[typeEnd];
        if (bDepth === 0 && pDepth === 0 && aDepth === 0) {
          if (c === "," || c === ")") {
            break;
          }
        }
        if (c === "{") {
          bDepth++;
        } else if (c === "}") {
          bDepth--;
        } else if (c === "(") {
          pDepth++;
        } else if (c === ")") {
          if (pDepth === 0) {
            break;
          }
          pDepth--;
        } else if (c === "<") {
          aDepth++;
        } else if (c === ">") {
          if (aDepth > 0) {
            aDepth--;
          }
        }
        typeEnd++;
      }
      firstParamType = maskedText.slice(typeStart, typeEnd).trim();
      i = typeEnd;
    }
  }

  let depth = 1;
  while (i < maskedText.length) {
    const c = maskedText[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return { firstParamType, paramListEnd: i };
      }
    }
    i++;
  }
  return undefined;
}

function findFunctionDefinitions(maskedText: string): FunctionDef[] {
  const results: FunctionDef[] = [];

  const p1 =
    /(?<![A-Za-z0-9_])(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g;
  const p2 =
    /(?<![A-Za-z0-9_])local\s+([A-Za-z_]\w*)\s*=\s*function\s*\(/g;

  for (const pattern of [p1, p2]) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(maskedText)) !== null) {
      const name = m[1];
      const defIdx = m.index;
      const openParenIdx = m.index + m[0].length - 1;
      const sig = parseParameterList(maskedText, openParenIdx);
      if (!sig) {
        continue;
      }
      const bodyStart = sig.paramListEnd + 1;
      const bodyEnd = findMatchingEnd(maskedText, bodyStart);
      results.push({
        name,
        defIdx,
        paramType: sig.firstParamType,
        bodyStart,
        bodyEnd,
      });
    }
  }

  results.sort((a, b) => a.defIdx - b.defIdx);
  return results;
}

interface ScanCacheEntry {
  text: string;
  aliasesKey: string;
  result: Map<string, DocumentComponentInfo>;
}
const scanCache: ScanCacheEntry[] = [];
const SCAN_CACHE_MAX = 4;

export function scanDocument(
  text: string,
  aliases: AliasPartition | string[]
): Map<string, DocumentComponentInfo> {
  const partition = asPartition(aliases);
  const aliasesKey =
    partition.parens.join("|") + " " + partition.curried.join("|");
  for (let i = scanCache.length - 1; i >= 0; i--) {
    if (scanCache[i].text === text && scanCache[i].aliasesKey === aliasesKey) {
      const hit = scanCache.splice(i, 1)[0];
      scanCache.push(hit);
      return hit.result;
    }
  }

  const { masked } = getMaskedDoc(text);
  const typeAliases = collectTypeAliases(masked);
  const components = new Map<string, DocumentComponentInfo>();

  for (const def of findFunctionDefinitions(masked)) {
    const lastSegment = def.name.split(".").pop()!;
    if (components.has(lastSegment)) {
      continue;
    }

    const defLineIndex = lineNumberOf(text, def.defIdx);
    const annotations = parseAnnotationsForComponent(text, defLineIndex);

    let paramTypeFields: string[] | undefined;
    if (def.paramType) {
      const tt = def.paramType.trim();
      if (tt.startsWith("{") && tt.endsWith("}")) {
        paramTypeFields = extractTypeFields(tt.slice(1, -1));
      } else if (/^[A-Za-z_]\w*$/.test(tt)) {
        const aliasFields = typeAliases.get(tt);
        if (aliasFields) {
          paramTypeFields = aliasFields;
        }
      }
    }

    const detectedBase = detectReturnedClass(
      text,
      masked,
      def.bodyStart,
      def.bodyEnd,
      partition
    );

    components.set(lastSegment, {
      name: lastSegment,
      defLineIndex,
      paramTypeFields,
      annotations,
      detectedBase,
    });
  }

  scanCache.push({ text, aliasesKey, result: components });
  if (scanCache.length > SCAN_CACHE_MAX) {
    scanCache.shift();
  }
  return components;
}

// ============================================================================
// findAllCreateElementCalls — used by inlay hints + document symbols
// ============================================================================

interface AllCallsCacheEntry {
  text: string;
  aliasesKey: string;
  result: CreateElementCall[];
}
const allCallsCache: AllCallsCacheEntry[] = [];
const ALL_CALLS_CACHE_MAX = 4;

export function findAllCreateElementCalls(
  text: string,
  aliases: AliasPartition | string[]
): CreateElementCall[] {
  const partition = asPartition(aliases);
  const aliasesKey =
    partition.parens.join("|") + " " + partition.curried.join("|");
  for (let i = allCallsCache.length - 1; i >= 0; i--) {
    if (
      allCallsCache[i].text === text &&
      allCallsCache[i].aliasesKey === aliasesKey
    ) {
      const hit = allCallsCache.splice(i, 1)[0];
      allCallsCache.push(hit);
      return hit.result;
    }
  }
  const result = findAllCreateElementCallsImpl(text, partition);
  allCallsCache.push({ text, aliasesKey, result });
  if (allCallsCache.length > ALL_CALLS_CACHE_MAX) {
    allCallsCache.shift();
  }
  // Sort by start position so consumers (inlay hints / symbols) see
  // document-order regardless of which pass produced them.
  result.sort((a, b) => a.aliasStart - b.aliasStart);
  return result;
}

function findAllCreateElementCallsImpl(
  text: string,
  partition: AliasPartition
): CreateElementCall[] {
  const { masked } = getMaskedDoc(text);
  const results: CreateElementCall[] = [];

  // Pass 1: parens form — `ALIAS ( ARG , {…}[, {…}] )`
  if (partition.parens.length > 0) {
    const aliasPattern = buildAliasAlternation(partition.parens);
    const re = new RegExp(
      `(?<![A-Za-z0-9_.])(?:${aliasPattern})\\s*\\(`,
      "g"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const aliasStart = m.index;
      const openParen = m.index + m[0].length - 1;
      const closeParen = findMatchingParen(masked, openParen);
      if (closeParen === -1) {
        continue;
      }

      const argRanges = splitTopLevelArgs(masked, openParen + 1, closeParen);
      if (argRanges.length < 2) {
        continue;
      }

      const classNameInfo = parseFirstArgClassName(
        text,
        argRanges[0].start,
        argRanges[0].end
      );
      if (!classNameInfo) {
        continue;
      }

      const propsText = text.slice(argRanges[1].start, argRanges[1].end);
      const nameMatch = /\bName\s*=\s*"([^"\n]*)"/.exec(propsText);
      const nameProp = nameMatch ? nameMatch[1] : undefined;

      let childrenStart: number | undefined;
      let childrenEnd: number | undefined;
      if (argRanges.length >= 3) {
        const childArg = argRanges[2];
        const openBrace = findFirstChar(
          masked,
          "{",
          childArg.start,
          childArg.end
        );
        if (openBrace !== -1) {
          const closeBrace = findMatchingBrace(masked, openBrace);
          if (closeBrace !== -1) {
            childrenStart = openBrace + 1;
            childrenEnd = closeBrace;
          }
        }
      }

      results.push({
        className: classNameInfo.name,
        isStringLiteralName: classNameInfo.isString,
        nameProp,
        aliasStart,
        fullEnd: closeParen + 1,
        classNameStart: classNameInfo.start,
        classNameEnd: classNameInfo.end,
        childrenStart,
        childrenEnd,
      });
    }
  }

  // Pass 2: curried form — `ALIAS "ARG" { … }`.
  // We anchor only on the alias keyword (which is in code position, so the
  // masked text is safe), then walk forward in the *original* text to read
  // the class-name token (string contents would be blanked in the masked
  // version) and locate the opening `{`.
  if (partition.curried.length > 0) {
    const aliasPattern = buildAliasAlternation(partition.curried);
    const aliasRe = new RegExp(
      `(?<![A-Za-z0-9_.])(?:${aliasPattern})(?=\\s)`,
      "g"
    );
    let m: RegExpExecArray | null;
    while ((m = aliasRe.exec(masked)) !== null) {
      const aliasStart = m.index;
      const aliasEnd = m.index + m[0].length;

      let i = aliasEnd;
      // Skip whitespace after the alias keyword.
      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }

      let name: string | undefined;
      let classNameStart = -1;
      let classNameEnd = -1;
      let isString = false;

      if (text[i] === '"' || text[i] === "'") {
        const quote = text[i];
        const close = text.indexOf(quote, i + 1);
        if (close === -1) {
          continue;
        }
        const candidate = text.slice(i + 1, close);
        if (!/^[A-Za-z_]\w*$/.test(candidate)) {
          continue;
        }
        name = candidate;
        classNameStart = i + 1;
        classNameEnd = close;
        isString = true;
        i = close + 1;
      } else if (/[A-Za-z_]/.test(text[i] ?? "")) {
        const start = i;
        while (i < text.length && /[A-Za-z0-9_.]/.test(text[i])) {
          i++;
        }
        name = text.slice(start, i);
        if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)) {
          continue;
        }
        classNameStart = start;
        classNameEnd = i;
        isString = false;
      } else {
        continue;
      }

      // Skip whitespace before the props `{`.
      while (i < text.length && /\s/.test(text[i])) {
        i++;
      }
      if (text[i] !== "{") {
        continue;
      }
      const openBrace = i;
      const closeBrace = findMatchingBrace(masked, openBrace);
      if (closeBrace === -1) {
        continue;
      }

      const propsText = text.slice(openBrace + 1, closeBrace);
      const nameMatch = /\bName\s*=\s*"([^"\n]*)"/.exec(propsText);
      const nameProp = nameMatch ? nameMatch[1] : undefined;

      results.push({
        className: name,
        isStringLiteralName: isString,
        nameProp,
        aliasStart,
        fullEnd: closeBrace + 1,
        classNameStart,
        classNameEnd,
        childrenStart: openBrace + 1,
        childrenEnd: closeBrace,
      });
    }
  }

  return results;
}

export function buildCallTree(calls: CreateElementCall[]): CallTreeNode[] {
  const sorted = [...calls].sort((a, b) => a.aliasStart - b.aliasStart);
  const nodes: CallTreeNode[] = sorted.map((call) => ({
    call,
    children: [],
  }));

  const roots: CallTreeNode[] = [];
  const stack: CallTreeNode[] = [];

  for (const node of nodes) {
    while (
      stack.length > 0 &&
      !containsInChildren(stack[stack.length - 1].call, node.call.aliasStart)
    ) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

function containsInChildren(
  parent: CreateElementCall,
  offset: number
): boolean {
  return (
    parent.childrenStart !== undefined &&
    parent.childrenEnd !== undefined &&
    offset > parent.childrenStart &&
    offset < parent.childrenEnd
  );
}

function findMatchingParen(text: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function findFirstChar(
  text: string,
  ch: string,
  start: number,
  end: number
): number {
  for (let i = start; i < end; i++) {
    if (text[i] === ch) {
      return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(
  masked: string,
  start: number,
  end: number
): Array<{ start: number; end: number }> {
  const args: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let argStart = start;
  for (let i = start; i < end; i++) {
    const c = masked[i];
    if (c === "(" || c === "{" || c === "[") {
      depth++;
    } else if (c === ")" || c === "}" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      args.push({ start: argStart, end: i });
      argStart = i + 1;
    }
  }
  if (argStart < end) {
    args.push({ start: argStart, end });
  }
  return args;
}

function parseFirstArgClassName(
  text: string,
  start: number,
  end: number
): { name: string; isString: boolean; start: number; end: number } | undefined {
  let i = start;
  while (i < end && /\s/.test(text[i])) {
    i++;
  }
  let j = end;
  while (j > i && /\s/.test(text[j - 1])) {
    j--;
  }
  if (i >= j) {
    return undefined;
  }
  const inner = text.slice(i, j);

  const stringMatch = /^["']([A-Za-z_]\w*)["']$/.exec(inner);
  if (stringMatch) {
    return {
      name: stringMatch[1],
      isString: true,
      start: i + 1,
      end: j - 1,
    };
  }
  const idMatch = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(
    inner
  );
  if (idMatch) {
    return {
      name: idMatch[1],
      isString: false,
      start: i,
      end: j,
    };
  }
  return undefined;
}

// ============================================================================
// Color literal extraction (for the DocumentColorProvider)
// ============================================================================

export function extractColorLiterals(maskedText: string): ColorLiteral[] {
  const out: ColorLiteral[] = [];
  const re = /\bColor3\.(fromRGB|new)\s*\(\s*([^()]+?)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(maskedText)) !== null) {
    const kind = m[1];
    const args = m[2].split(",").map((s) => s.trim());
    if (args.length !== 3) {
      continue;
    }
    const parsed = args.map((s) => Number(s));
    if (parsed.some((n) => !Number.isFinite(n))) {
      continue;
    }
    let r: number;
    let g: number;
    let b: number;
    if (kind === "fromRGB") {
      r = parsed[0] / 255;
      g = parsed[1] / 255;
      b = parsed[2] / 255;
    } else {
      r = parsed[0];
      g = parsed[1];
      b = parsed[2];
    }
    if ([r, g, b].some((n) => n < 0 || n > 1)) {
      continue;
    }
    out.push({
      r,
      g,
      b,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

// ============================================================================
// Small utility used by several providers
// ============================================================================

export function pushUnique(target: string[], items: string[]): void {
  for (const item of items) {
    if (!target.includes(item)) {
      target.push(item);
    }
  }
}

export function collectLocalBindings(text: string): Set<string> {
  const masked = applyMask(text, buildCodeMask(text));
  const out = new Set<string>();
  // Matches both `local X = ...` and `local function X(...)`.
  const re = /(?<![A-Za-z0-9_])local\s+(?:function\s+)?([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    out.add(m[1]);
  }
  return out;
}
