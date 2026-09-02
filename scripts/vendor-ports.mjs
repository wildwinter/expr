// ---------------------------------------------------------------------------
// Vendor the shared port sources into each consuming addon.
//
// `ports/` holds ONE implementation per platform. This copies each into both
// product families, applying whatever identity substitution that platform
// needs, so the two installed plugins never declare the same symbol:
//
//   GDScript  no `class_name` at all, so the file is copied verbatim and each
//             family wraps it in its own thin class_name shim. Godot registers
//             class_name project-wide, so a shared file claiming one would
//             collide the moment a game installed both addons.
//   C++       __EXPR_NS__ -> patter / storylets, giving patter::expr and
//             storylets::expr. Two header-only copies under one name would be
//             an ODR violation the linker resolves silently.
//   C#        __EXPR_NS__ -> the family's root namespace. Unity requires
//             assembly definition names to be unique project-wide, so the
//             shared code lives inside each plugin's existing asmdef.
//
// Vendored at COMMIT time, not build time: a game installs these as a UPM
// package or a plugin zip, so the copy has to be in the shipped artifact.
//
//   node scripts/vendor-ports.mjs          # write
//   node scripts/vendor-ports.mjs --check  # verify, exit 1 on drift
//
// CI runs --check, so a hand edit to a vendored copy fails the build instead
// of quietly becoming a seventh dialect of the same 200 lines.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";


/** Unity tracks a .meta beside every asset, and a missing one makes the editor
 *  mint a fresh GUID on import, which then shows up as a spurious change. The
 *  GUID is derived from the asset's path so it is STABLE across regeneration:
 *  a random one would make the --check below fail on every run. */
const unityGuid = (rel) => createHash("md5").update(`wildwinter/expr:${rel}`).digest("hex");

const fileMeta = (rel) => `fileFormatVersion: 2\nguid: ${unityGuid(rel)}\n`;

const folderMeta = (rel) =>
  `fileFormatVersion: 2\nguid: ${unityGuid(rel)}\nfolderAsset: yes\nDefaultImporter:\n` +
  `  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;

const root = fileURLToPath(new URL("..", import.meta.url));
const parent = path.resolve(root, "..");
const check = process.argv.includes("--check");

/** One vendored file per family. `ns` is the identity stamped in at copy time. */
const families = [
  {
    repo: "storylets",
    godot: "storylets/ports/godot/addons/storyletengine/runtime/expr",
    unreal: "storylets/ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Expr",
    unity: "storylets/ports/unity/StoryletEngine/Runtime/Expr",
    cs: { __EXPR_NS__: "StoryletStudio.StoryletEngine", __EXPR_VALUE__: "StoryletValue", __EXPR_KIND__: "StoryletKind", __EXPR_ERROR__: "StoryletError" },
    tooling: {
      __EXPR_LOCKSTEP__: "@storylet-studio/runtime",
      __EXPR_FAMILY__: "Storylet Engine",
      __EXPR_UE_DEMO__: "StoryletEngineDemo",
      __EXPR_BAG_LABEL__: "StoryletPropertyBag",
    },
    cpp: {
      __EXPR_NS__: "storylets",
      __EXPR_VALUE__: "StoryletValue",
      __EXPR_KIND__: "StoryletKind",
      __EXPR_VALUE_HEADER__: '"Storylets/StoryletValue.h"',
      __EXPR_ERROR__: "StoryletError",
      __EXPR_ORDEREDMAP_HEADER__: '"Storylets/Expr/OrderedMap.h"',
        __EXPR_PROPERTYBAG_HEADER__: '"Storylets/Expr/PropertyBag.h"',
      __EXPR_AST_HEADER__: '"Storylets/Expr/Ast.h"',
    },
  },
  {
    repo: "patter",
    godot: "patter/ports/godot/addons/patterplay/runtime/expr",
    unreal: "patter/ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Expr",
    unity: "patter/ports/unity/Patterplay/Runtime/Expr",
    cs: { __EXPR_NS__: "Patterkit.Patterplay", __EXPR_VALUE__: "PatterValue", __EXPR_KIND__: "PatterKind", __EXPR_ERROR__: "EvalError" },
    tooling: {
      __EXPR_LOCKSTEP__: "@patterkit/runtime",
      __EXPR_FAMILY__: "Patterplay",
      __EXPR_UE_DEMO__: "PatterplayDemo",
      __EXPR_BAG_LABEL__: "PatterPropertyBag",
    },
    cpp: {
      __EXPR_NS__: "patter",
      __EXPR_VALUE__: "PatterValue",
      __EXPR_KIND__: "PatterKind",
      __EXPR_VALUE_HEADER__: '"Patter/PatterValue.h"',
      __EXPR_ERROR__: "EvalError",
      __EXPR_ORDEREDMAP_HEADER__: '"Patter/Expr/OrderedMap.h"',
        __EXPR_PROPERTYBAG_HEADER__: '"Patter/Expr/PropertyBag.h"',
      __EXPR_AST_HEADER__: '"Patter/Expr/Ast.h"',
    },
  },
];

/** Replace every placeholder, and refuse to ship a file that still has one. */
const substitute = (text, map, rel) => {
  let out = text;
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
  const left = out.match(/__EXPR_[A-Z_]+__/);
  if (left) throw new Error(`${rel}: unsubstituted placeholder ${left[0]}`);
  return out;
};

const sources = [
  { from: "ports/godot/values.gd", to: (f) => `${f.godot}/values.gd`, comment: "#" },
  { from: "ports/godot/expr_eval.gd", to: (f) => `${f.godot}/expr_eval.gd`, comment: "#" },
  { from: "ports/godot/expr_specificity.gd", to: (f) => `${f.godot}/expr_specificity.gd`, comment: "#" },
  { from: "ports/godot/mulberry32.gd", to: (f) => `${f.godot}/mulberry32.gd`, comment: "#" },
  { from: "ports/godot/property_bag.gd", to: (f) => `${f.godot}/property_bag.gd`, comment: "#", subs: (f) => f.tooling },
  { from: "ports/godot/state_logger.gd", to: (f) => `${f.godot}/state_logger.gd`, comment: "#", subs: (f) => f.tooling },
  { from: "ports/godot/bundle_view.gd", to: (f) => `${f.godot}/bundle_view.gd`, comment: "#" },
  { from: "ports/godot/bundle_import_plugin.gd", to: (f) => `${f.godot}/bundle_import_plugin.gd`, comment: "#" },
  { from: "ports/godot/bundle_export_plugin.gd", to: (f) => `${f.godot}/bundle_export_plugin.gd`, comment: "#" },
  { from: "ports/unreal/Value.h", to: (f) => `${f.unreal}/Value.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/Ast.h", to: (f) => `${f.unreal}/Ast.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/Expr.h", to: (f) => `${f.unreal}/Expr.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/Specificity.h", to: (f) => `${f.unreal}/Specificity.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/Mulberry32.h", to: (f) => `${f.unreal}/Mulberry32.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/OrderedMap.h", to: (f) => `${f.unreal}/OrderedMap.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/PropertyBag.h", to: (f) => `${f.unreal}/PropertyBag.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unreal/StateLogger.h", to: (f) => `${f.unreal}/StateLogger.h`, comment: "//", subs: (f) => f.cpp },
  { from: "ports/unity/Value.cs", to: (f) => `${f.unity}/Value.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/Ast.cs", to: (f) => `${f.unity}/Ast.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/Expr.cs", to: (f) => `${f.unity}/Expr.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/Specificity.cs", to: (f) => `${f.unity}/Specificity.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/Mulberry32.cs", to: (f) => `${f.unity}/Mulberry32.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/OrderedMap.cs", to: (f) => `${f.unity}/OrderedMap.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/PropertyBag.cs", to: (f) => `${f.unity}/PropertyBag.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  { from: "ports/unity/StateLogger.cs", to: (f) => `${f.unity}/StateLogger.cs`, comment: "//", subs: (f) => f.cs, meta: "file" },
  // The repos' own release tooling. Not a port, but the same argument applies and the
  // numbers are worse: 99% and 100% identical once family names are normalised, and a
  // bug in the guard had to be fixed in both copies within an hour of the second being
  // written. The duplication scanner could not see either file until it was taught to
  // look at scripts/ on the same day.
  { from: "tooling/release-guard.mjs", to: (f) => `${f.repo}/scripts/release-guard.mjs`, comment: "//", subs: (f) => f.tooling },
  { from: "tooling/check-unreal-plugin.sh", to: (f) => `${f.repo}/scripts/check-unreal-plugin.sh`, comment: "#", subs: (f) => f.tooling, exec: true },
];

const banner = (rel, c) =>
  `${c} GENERATED - vendored from expr/${rel} by scripts/vendor-ports.mjs.\n` +
  `${c} Do not edit here; edit the shared source and re-run the script.\n`;

let drifted = 0;
let skipped = 0;

for (const family of families) {
  const repoDir = path.join(parent, family.repo);
  // A sibling that is not checked out is not a failure: someone working in
  // expr alone should not be blocked by a repo they do not have.
  if (!existsSync(repoDir)) {
    console.log(`skip   ${family.repo} (not checked out)`);
    skipped++;
    continue;
  }
  for (const src of sources) {
    const text = readFileSync(path.join(root, src.from), "utf8");
    const stamped = src.subs ? substitute(text, src.subs(family), src.from) : text;
    // A shebang has to stay on line 1, so the banner goes after it rather than above it.
    const shebang = stamped.startsWith("#!") ? stamped.slice(0, stamped.indexOf("\n") + 1) : "";
    const want = shebang + banner(src.from, src.comment) + stamped.slice(shebang.length);
    const dest = path.join(parent, src.to(family));
    mkdirSync(path.dirname(dest), { recursive: true });
    const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
    if (have === want) {
      console.log(`ok     ${src.to(family)}`);
      continue;
    }
    if (check) {
      console.error(`DRIFT  ${src.to(family)} ${have === null ? "(missing)" : "(differs from the shared source)"}`);
      drifted++;
    } else {
      writeFileSync(dest, want);
      // A vendored shell script that is not executable is a script nobody can run,
      // and the mode does not travel with the text.
      if (src.exec) chmodSync(dest, 0o755);
      console.log(`wrote  ${src.to(family)}`);
    }
  }

  // Unity .meta sidecars for the vendored C# and its folder.
  if (family.unity) {
    const metas = [
      [path.join(parent, `${family.unity}.meta`), folderMeta(`${family.unity}`)],
      [path.join(parent, `${family.unity}/Value.cs.meta`), fileMeta(`${family.unity}/Value.cs`)],
      [path.join(parent, `${family.unity}/Ast.cs.meta`), fileMeta(`${family.unity}/Ast.cs`)],
      [path.join(parent, `${family.unity}/Expr.cs.meta`), fileMeta(`${family.unity}/Expr.cs`)],
      [path.join(parent, `${family.unity}/Specificity.cs.meta`), fileMeta(`${family.unity}/Specificity.cs`)],
      [path.join(parent, `${family.unity}/Mulberry32.cs.meta`), fileMeta(`${family.unity}/Mulberry32.cs`)],
    ];
    for (const [dest, want] of metas) {
      const rel = path.relative(parent, dest);
      const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
      if (have === want) { console.log(`ok     ${rel}`); continue; }
      if (check) { console.error(`DRIFT  ${rel} ${have === null ? "(missing)" : "(differs)"}`); drifted++; }
      else { writeFileSync(dest, want); console.log(`wrote  ${rel}`); }
    }
  }
}

if (drifted) {
  console.error(`\n${drifted} vendored ${drifted === 1 ? "copy is" : "copies are"} out of date.`);
  console.error("Run `node scripts/vendor-ports.mjs` in ../expr and commit the result in each repo.");
  process.exit(1);
}
if (check && skipped === families.length) {
  console.error("\nNo sibling repo was checked out, so nothing was verified.");
  process.exit(2);
}
