// ---------------------------------------------------------------------------
// FNV-1a, 32-bit.
//
// A published, fixed algorithm. Not cryptographic: it is for short stable
// handles and change detection, where the properties that matter are that it is
// the same everywhere and does not move between runs.
// ---------------------------------------------------------------------------

/** FNV-1a over a string's UTF-16 code units, as an unsigned 32-bit integer. */
export function fnv32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
