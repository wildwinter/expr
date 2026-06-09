// Cut a GitHub Release for the @wildwinter monorepo. Publishing is automated:
// creating the Release triggers .github/workflows/publish.yml, which publishes
// every package whose current version is not yet on GitHub Packages (expr first,
// then scoperegistry). So the only manual step a release needs is this.
//
// Usage:
//   npm run release             # tag = v<expr version> (the common case)
//   npm run release -- v0.3.0   # explicit tag, e.g. for a scoperegistry-only bump
//
// Safety: refuses to release a dirty or unpushed tree, so the Release never
// points at a commit that isn't on origin.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const version = (rel) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")).version;

const exprV = version("../packages/expr/package.json");
const regV = version("../packages/scoperegistry/package.json");
const tag = process.argv[2] ?? `v${exprV}`;

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };

if (sh("git status --porcelain")) fail("working tree is dirty - commit or stash first.");

// Best-effort "is it pushed?" guard (skipped if no upstream is configured).
try {
  sh("git fetch --quiet");
  if (sh("git rev-list --count @{upstream}..HEAD") !== "0") {
    fail("HEAD is ahead of its upstream - push before releasing.");
  }
} catch {
  console.warn("release: no upstream tracking branch; skipping the push check.");
}

const notes =
  `Triggers the publish workflow: @wildwinter/expr@${exprV} and ` +
  `@wildwinter/scoperegistry@${regV} (each skipped if already on the registry).`;

console.log(`release: creating ${tag} (expr ${exprV}, scoperegistry ${regV}) ...`);
execSync(`gh release create ${tag} --title ${tag} --notes ${JSON.stringify(notes)}`, { stdio: "inherit" });
console.log("release: created. Watch the publish run with:  gh run watch");
