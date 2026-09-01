// ---------------------------------------------------------------------------
// Stable, immutable, opaque ids.
//
// Generated at creation, never derived from content or position, so an id
// survives moving, renaming and reordering the thing it names. A short,
// collision-resistant base-36 token with an optional type prefix that aids
// debugging but carries no meaning.
// ---------------------------------------------------------------------------

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Generate a new opaque id, e.g. `newId("scn") -> "scn_8f3kq2z1"`. */
export function newId(prefix = "", length = 8): string {
  // Rejection-sample so every alphabet character is equally likely: a plain
  // `byte % 36` over-weights the first four characters.
  const limit = 256 - (256 % ALPHABET.length); // 252
  let token = "";
  while (token.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      token += ALPHABET[b % ALPHABET.length];
      if (token.length === length) break;
    }
  }
  return prefix ? `${prefix}_${token}` : token;
}

/** A url-ish slug from a human label; `"project"` when nothing usable is left. */
export function slug(name: string, fallback = "project"): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}
