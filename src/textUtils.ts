// Tiny zero-dependency text helpers shared by the gradient / rect /
// hover-preview parsers. The parser.ts internal helpers stay private
// because they're deeply tied to the masked-text caching there; these
// versions operate on raw input strings.

/**
 * Find the matching `)` for an `(` at `openIdx`. Returns `-1` if the
 * paren is never closed within the string. Does NOT handle escapes or
 * skip parens inside string literals — callers operating on potentially
 * stringful input should pre-mask the text.
 */
export function findMatchingParen(text: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Find the matching `}` for a `{` at `openIdx`. Same caveat as
 * `findMatchingParen` re: string literals.
 */
export function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Skip ASCII whitespace forward from `start` up to `end`. Returns the
 * first non-whitespace offset (or `end` if all whitespace).
 */
export function skipWs(text: string, start: number, end: number): number {
  let i = start;
  while (i < end && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

/**
 * Trim leading and trailing whitespace from a `[start, end)` slice,
 * returning a tightened range. Doesn't allocate a new string.
 */
export function trimRange(
  text: string,
  start: number,
  end: number
): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) {
    s++;
  }
  while (e > s && /\s/.test(text[e - 1])) {
    e--;
  }
  return { start: s, end: e };
}

/**
 * Split a `[start, end)` range into comma-separated sub-ranges at
 * top-level depth (i.e. ignoring commas nested inside `()` or `{}`).
 * Each returned range is trimmed of leading/trailing whitespace.
 */
export function splitTopLevelArgs(
  text: string,
  start: number,
  end: number
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let pDepth = 0;
  let bDepth = 0;
  let argStart = start;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === "(") {
      pDepth++;
    } else if (c === ")") {
      pDepth--;
    } else if (c === "{") {
      bDepth++;
    } else if (c === "}") {
      bDepth--;
    } else if (c === "," && pDepth === 0 && bDepth === 0) {
      const trimmed = trimRange(text, argStart, i);
      if (trimmed.start < trimmed.end) {
        out.push(trimmed);
      }
      argStart = i + 1;
    }
  }
  const last = trimRange(text, argStart, end);
  if (last.start < last.end) {
    out.push(last);
  }
  return out;
}
