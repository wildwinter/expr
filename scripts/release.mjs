// Cut a GitHub Release for the @wildwinter monorepo, with the version bump
// baked into the command. Publishing is automated: creating the Release
// triggers .github/workflows/publish.yml, which publishes every package whose
// package.json version is not yet on the public npm registry (npmjs.org).
//
// The publish workflow is VERSION-driven, not tag-driven: it skips any package
// whose current version is already on the registry. So a release that doesn't
// actually bump a version is a silent no-op (a green "Publish" step that
// publishes nothing). To make that impossible, the bump happens HERE - the
// released tag always points at a freshly-bumped, not-yet-published version.
//
// Usage:
//   npm run release:expr -- patch          # 0.2.1 -> 0.2.2
//   npm run release:expr -- minor          # 0.2.1 -> 0.3.0
//   npm run release:expr -- 0.4.0          # explicit version
//   npm run release:scoperegistry -- patch
//   npm run release -- expr patch          # long form
//
// Safety: refuses a dirty or unpushed tree, an unknown package, a missing
// bump, a bump that doesn't change the version, or a target version already
// on the registry (the old silent no-op - now a loud failure).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGES = {
  expr:          { dir: "packages/expr",          pkg: "@wildwinter/expr",          tag: (v) => `v${v}` },
  scoperegistry: { dir: "packages/scoperegistry", pkg: "@wildwinter/scoperegistry", tag: (v) => `scoperegistry-v${v}` },
};

const sh   = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run  = (cmd) => execSync(cmd, { stdio: "inherit" });
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };
const pkgPath = (dir) => new URL(`../${dir}/package.json`, import.meta.url);
const readPkg = (dir) => JSON.parse(readFileSync(pkgPath(dir), "utf8"));
const versionOf = (dir) => readPkg(dir).version;

// Does version `v` satisfy a simple `^x.y.z` caret range? We only ever write
// caret ranges between these workspaces, so a hand-rolled check beats pulling
// in semver. Caret semantics: the leftmost non-zero component is pinned.
//   ^1.2.3 -> >=1.2.3 <2.0.0     ^0.3.0 -> >=0.3.0 <0.4.0     ^0.0.3 -> ==0.0.3
const caretSatisfies = (range, v) => {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) return true; // not a plain caret range - leave it alone
  const [a, b, c] = m.slice(1).map(Number);
  const [x, y, z] = v.split(".").map(Number);
  if (x !== a) return false;
  if (a > 0) return y > b || (y === b && z >= c);
  if (y !== b) return false;
  if (b > 0) return z >= c;
  return z === c;
};

const [pkgArg, bump] = process.argv.slice(2);
const target = PACKAGES[pkgArg ?? ""];
if (!target) {
  fail(`usage: npm run release -- <${Object.keys(PACKAGES).join(" | ")}> <patch | minor | major | x.y.z>`);
}
if (!bump) {
  fail(`missing bump: npm run release -- ${pkgArg} <patch | minor | major | x.y.z>`);
}

// Tree must be clean and pushed BEFORE we bump, so the release commit is the
// only new thing on the tag and we never publish work that isn't on origin.
if (sh("git status --porcelain")) fail("working tree is dirty - commit or stash first.");
try {
  sh("git fetch --quiet");
  if (sh("git rev-list --count @{upstream}..HEAD") !== "0") {
    fail("HEAD is ahead of its upstream - push before releasing.");
  }
} catch {
  console.warn("release: no upstream tracking branch; skipping the push check.");
}

// Bump package.json only - we make the commit + tag ourselves below so the
// tag name always matches the new version.
const before = versionOf(target.dir);
run(`npm version ${JSON.stringify(bump)} --no-git-tag-version --workspace ${target.dir}`);
const after = versionOf(target.dir);
if (after === before) fail(`version unchanged (still ${before}) - nothing to release.`);

// Loud guard against the silent no-op: a version already on the public npm
// registry would be skipped by the publish workflow. Revert the bump and stop.
// Force the public registry for the @wildwinter scope here, overriding any
// local .npmrc scope mapping (e.g. a GitHub Packages consumer mapping), so the
// check targets the same registry the workflow publishes to.
const published = sh(`npm view ${target.pkg}@${after} version --@wildwinter:registry=https://registry.npmjs.org 2>/dev/null || true`);
if (published === after) {
  run(`git checkout -- ${target.dir}/package.json package-lock.json`);
  fail(`${target.pkg}@${after} is already on the registry; bump to a newer version.`);
}

// Keep dependent workspaces in lockstep. A minor/major bump of `target.pkg`
// can push its new version outside a dependant's caret range (e.g. ^0.3.0
// stops satisfying 0.4.0). The workspace link then silently breaks and CI
// falls back to the registry - which is exactly what failed the 0.3.0 cut.
// Re-point any out-of-range dependant at `^${after}` and relink the tree.
const synced = [];
for (const [name, { dir }] of Object.entries(PACKAGES)) {
  if (name === pkgArg) continue;
  const pkg = readPkg(dir);
  const range = pkg.dependencies?.[target.pkg];
  if (!range || caretSatisfies(range, after)) continue;
  pkg.dependencies[target.pkg] = `^${after}`;
  writeFileSync(pkgPath(dir), JSON.stringify(pkg, null, 2) + "\n");
  synced.push({ name, dir, from: range });
  console.log(`release: ${name} now requires ${target.pkg}@^${after} (was ${range})`);
}
if (synced.length) {
  run("npm install --package-lock-only --ignore-scripts"); // relink the lockfile to the new range
}

const tag = target.tag(after);
console.log(`release: ${target.pkg} ${before} -> ${after} (tag ${tag})`);

run(`git add ${target.dir}/package.json package-lock.json${synced.map((s) => ` ${s.dir}/package.json`).join("")}`);
run(`git commit -m ${JSON.stringify(`chore(release): ${target.pkg}@${after}`)}`);
run("git push");

const notes = `Publishes ${target.pkg}@${after} via the publish workflow.`;
run(`gh release create ${tag} --title ${tag} --notes ${JSON.stringify(notes)}`);
console.log(`release: ${tag} created. Watch the publish run with:  gh run watch`);
