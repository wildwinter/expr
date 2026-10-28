// ---------------------------------------------------------------------------
// Game IDs: the author-editable, host-facing address a game uses for a thing
// (a Patter scene or block, a Storylet box, deck, card or outcome), distinct
// from the opaque immutable id. A hyphen-slug, derived from the thing's name
// until an author pins one.
//
// Both families had this rule word for word (Patter's model, and Storylets',
// adopted from Patter's on 2026-07-20), and Storyletter matches a card to its
// Patter scene by it, so the two copies must never drift. What each family
// derives an address FROM (a name; a title, else the id) stays with the family.
// ---------------------------------------------------------------------------

/**
 * Turn a name into a Game ID: lower case, apostrophes (straight and curly) dropped,
 * every run of anything but a-z, 0-9 and hyphens made one hyphen, repeated hyphens
 * collapsed, and none at either end. Can be empty (`"!!!"`, or a name with no ASCII
 * letters or digits); a caller falls back as it sees fit.
 */
export function gameIdify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A valid authored Game ID: lower-case letters, digits and hyphens, with no hyphen at either end. */
export function isValidGameId(gameId: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(gameId);
}
