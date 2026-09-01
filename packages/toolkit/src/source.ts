// ---------------------------------------------------------------------------
// Reading authored source files.
// ---------------------------------------------------------------------------

import JSON5 from "json5";

/**
 * Parse JSON5 source text. A leading byte-order mark is tolerated, because
 * editors on Windows add one and JSON5 will not accept it. Throws on malformed
 * input.
 */
export function parseSource(text: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON5.parse(body);
}
