// ---------------------------------------------------------------------------
// Copy the expr parity corpus into the sibling repos that consume it.
//
// The corpus is authored here and vendored there, rather than read across a
// checkout boundary, so each port repo stays self-contained: its test hosts
// run with no assumption that ../expr exists beside it.
//
// Run with --check to verify the vendored copies are current without writing.
// That is what CI runs: a hand-edit of a vendored copy, or an update here that
// was never propagated, fails the build instead of drifting quietly.
//
//   node scripts/sync-conformance.mjs          # write
//   node scripts/sync-conformance.mjs --check  # verify, exit 1 on drift
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(root, "packages/conformance/corpus.json");

/** Where each family vendors it. Relative to the parent of this repo. */
const targets = [
  "storylets/packages/conformance/expr-corpus.json",
  "patter/packages/conformance/expr-corpus.json",
];

const check = process.argv.includes("--check");

if (!existsSync(source)) {
  console.error(`corpus not built: ${source}\nrun \`npm test -w @wildwinter/expr-conformance\` first`);
  process.exit(2);
}
const want = readFileSync(source, "utf8");
const parent = path.resolve(root, "..");

let drifted = 0;
let missing = 0;
for (const rel of targets) {
  const dest = path.join(parent, rel);
  // A sibling that is not checked out is not a failure: someone working in
  // expr alone should not be blocked by a repo they do not have.
  if (!existsSync(path.dirname(dest))) {
    console.log(`skip   ${rel} (sibling not checked out)`);
    missing++;
    continue;
  }
  const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
  if (have === want) {
    console.log(`ok     ${rel}`);
    continue;
  }
  if (check) {
    console.error(`DRIFT  ${rel} ${have === null ? "(missing)" : "(differs from the authored corpus)"}`);
    drifted++;
  } else {
    writeFileSync(dest, want);
    console.log(`wrote  ${rel}`);
  }
}

if (drifted) {
  console.error(`\n${drifted} vendored ${drifted === 1 ? "copy is" : "copies are"} out of date.`);
  console.error("Run `node scripts/sync-conformance.mjs` in ../expr and commit the result in each repo.");
  process.exit(1);
}
if (check && missing === targets.length) {
  console.error("\nNo sibling repo was checked out, so nothing was verified.");
  console.error("This check only means something where storylets and patter sit beside expr.");
  process.exit(2);
}
