// ---------------------------------------------------------------------------
// Archive guards and settings, for the pack / unpack ops.
//
// Two concerns that both product families had solved, identically, in their own
// copies:
//
//   - REFUSING A HOSTILE ENTRY. A zip can name `../../etc/passwd`, and writing
//     it where it asks is the "zip slip" class of bug. Both guards below were
//     correct in both families, which is the state BEFORE the drift rather than
//     evidence there will not be one: a subtle weakening of one copy is a
//     vulnerability nobody reads a diff for.
//   - DETERMINISTIC BYTES. A pack of an unchanged project must be byte-identical
//     to the last one, or every delivery churns. That needs a fixed entry
//     timestamp and no folder entries, which is easy to leave out and silent
//     when you do.
//
// Nothing here knows what is being packed.
// ---------------------------------------------------------------------------

import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

/** An entry whose name refuses to be trusted at all: absolute, drive-lettered,
 *  or climbing out with `..`. A cheap first pass, used where a NAME is all that
 *  is available. */
export function isUnsafeEntry(name: string): boolean {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return true;
  const norm = normalize(name);
  return norm === ".." || norm.startsWith(`..${sep}`) || norm.startsWith("../");
}

/**
 * True when `join(targetDir, name)` would land outside `targetDir`.
 *
 * This is the guard that actually holds, and it is deliberately about the
 * RESOLVED PATH rather than the name: containment of a resolved path is a fact
 * about the write, where a judgement about a name is a guess about one. The
 * target itself counts as outside, because an entry that resolves to the
 * directory is not a file to write.
 */
export function escapesTarget(targetDir: string, name: string): boolean {
  const target = resolve(targetDir);
  const full = resolve(join(target, name));
  const rel = relative(target, full);
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** The fixed timestamp every archive entry carries, so an unchanged project
 *  packs to the same bytes. Any constant would do; it must not be "now". */
export const ARCHIVE_ENTRY_DATE = new Date("2000-01-01T00:00:00Z");

/** Entry options for a reproducible archive: the fixed date, and no folder
 *  entries (whose presence and order vary by writer). */
export const ARCHIVE_ENTRY_OPTS = { date: ARCHIVE_ENTRY_DATE, createFolders: false } as const;

/** Generation options for a reproducible archive. `streamFiles: false` matters:
 *  streamed entries carry data descriptors, which differ run to run. */
export const ARCHIVE_GENERATE_OPTS = {
  type: "nodebuffer",
  compression: "DEFLATE",
  streamFiles: false,
} as const;
