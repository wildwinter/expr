// ---------------------------------------------------------------------------
// Copy the shared corpora into the sibling repos that consume them: the expr
// parity corpus (packages/conformance) and the registry corpus
// (packages/scoperegistry), which every native copy of the ScopeRegistry runs;
// and the family's shared vocabulary (family/engine-scopes.json), which each
// product's compiler reads.
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

/** Each corpus, where it is authored, how it is rebuilt, and where each family vendors it
 *  (relative to the parent of this repo). */
const corpora = [
  {
    source: path.join(root, "packages/conformance/corpus.json"),
    rebuild: "npm test -w @wildwinter/expr-conformance",
    targets: ["storylets/packages/conformance/expr-corpus.json", "patter/packages/conformance/expr-corpus.json"],
  },
  {
    source: path.join(root, "packages/scoperegistry/corpus.json"),
    rebuild: "npm test -w @wildwinter/scoperegistry",
    targets: ["storylets/packages/conformance/registry-corpus.json", "patter/packages/conformance/registry-corpus.json", "lockstep/runtime/csharp/Storytools.Lockstep.Tests/registry-corpus.json"],
  },
];

/** The family's shared vocabulary, written into each product as a TypeScript module (their
 *  packages do not import JSON), with a banner, so the product's compiler reads the same list. */
const vocabulary = {
  source: path.join(root, "family/engine-scopes.json"),
  targets: ["storylets/packages/dialect/src/engine-scopes.ts", "patter/packages/dialect/src/engine-scopes.ts"],
  render: (json) => {
    const { scopes } = JSON.parse(json);
    const rows = scopes.map((s) => `  { token: ${JSON.stringify(s.token)}, engine: ${JSON.stringify(s.engine)}, means: ${JSON.stringify(s.means)} },`).join("\n");
    return [
      "// GENERATED - vendored from expr/family/engine-scopes.json by scripts/sync-conformance.mjs.",
      "// Do not edit here; edit the shared list and re-run the script.",
      "",
      "/** Every engine's game-wide scope token across the family. A compiler accepts every token here",
      " *  that is not its own engine's, unchecked: the other engine owns those names and types. */",
      "export interface EngineScope {",
      "  token: string;",
      "  engine: string;",
      "  means: string;",
      "}",
      "",
      "export const ENGINE_SCOPES: readonly EngineScope[] = [",
      rows,
      "];",
      "",
    ].join("\n");
  },
};

const check = process.argv.includes("--check");

const parent = path.resolve(root, "..");

let drifted = 0;
let missing = 0;
let total = 0;
for (const { source, rebuild, targets } of corpora) {
  if (!existsSync(source)) {
    console.error(`corpus not built: ${source}\nrun \`${rebuild}\` first`);
    process.exit(2);
  }
  const want = readFileSync(source, "utf8");
  for (const rel of targets) {
    total++;
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
}

{
  const want = vocabulary.render(readFileSync(vocabulary.source, "utf8"));
  for (const rel of vocabulary.targets) {
    total++;
    const dest = path.join(parent, rel);
    if (!existsSync(path.dirname(dest))) { console.log(`skip   ${rel} (sibling not checked out)`); missing++; continue; }
    const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
    if (have === want) { console.log(`ok     ${rel}`); continue; }
    if (check) { console.error(`DRIFT  ${rel} ${have === null ? "(missing)" : "(differs from the family list)"}`); drifted++; }
    else { writeFileSync(dest, want); console.log(`wrote  ${rel}`); }
  }
}

if (drifted) {
  console.error(`\n${drifted} vendored ${drifted === 1 ? "copy is" : "copies are"} out of date.`);
  console.error("Run `node scripts/sync-conformance.mjs` in ../expr and commit the result in each repo.");
  process.exit(1);
}
if (check && missing === total) {
  console.error("\nNo sibling repo was checked out, so nothing was verified.");
  console.error("This check only means something where storylets and patter sit beside expr.");
  process.exit(2);
}
