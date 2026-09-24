// ---------------------------------------------------------------------------
// Vendor the shared port sources into each consuming addon.
//
// `ports/` holds ONE implementation per platform. This copies each into both
// product families, with whatever identity that platform needs: GDScript
// declares none and takes each family's names in a shim, while C++ and C# are
// one kernel each, which both families ship and a game compiles once:
//
//   GDScript  no `class_name` at all, so the file is copied verbatim and each
//             family wraps it in its own thin class_name shim. Godot registers
//             class_name project-wide, so a shared file claiming one would
//             collide the moment a game installed both addons.
//   C++       NO per-family substitution in the kernel headers. They are ONE
//             kernel (wildwinter::expr: ExprValue, ScopeRegistry, and the
//             rest), vendored byte-identical into every family's plugin, whose
//             inline namespace, include guards and tripwire macro all carry the
//             KERNEL ID: a short content hash of the kernel's shared sources,
//             computed here and stamped into every copy alike (__EXPR_KERNEL_ID__,
//             the identifier; __EXPR_KERNEL_HASH__, the same hash as a number
//             the preprocessor can compare). A game module including two
//             plugins' copies of the same kernel compiles each class once, so
//             one registry object can be handed to both engines; two copies of
//             DIFFERENT kernels in one translation unit stop at an #error naming
//             the fix, instead of building two types, or one type with two
//             definitions (an ODR violation the linker resolves silently).
//             Change a kernel header and the id changes, so the two products
//             release a kernel change together. The registry corpus runner is
//             test code, not kernel: it carries the kernel id too, and is
//             stamped per family only with the include of that family's copy.
//   C#        NO substitution. The C# sources are ONE kernel (Wildwinter.Expr:
//             ExprValue, ScopeRegistry, and the rest), vendored byte-identical
//             into every family's Runtime/Expr folder, each copy in the family's
//             own kernel assembly definition, which this script also writes. A
//             game with several products installed compiles the kernel ONCE:
//             one family HOSTS it (its kernel assembly always compiles), and
//             every other family DEFERS, its kernel assembly switching itself
//             off when a new enough host is installed. So ExprValue and
//             ScopeRegistry are one type in the game, and one registry can be
//             handed to every engine. Every family's runtime assemblies
//             reference every kernel assembly name; Unity ignores the absent
//             ones.
//
// The Unity kernel, per family (`unityKernel` in the families list):
//
//   assembly   the kernel assembly definition's name, written into the
//              family's `unity` folder with its .meta. Unique project-wide, as
//              Unity requires. Its prefix (before `.Expr`), upper-cased, names
//              the family's define symbols: PATTERPLAY_PRESENT and
//              PATTERPLAY_EXPR_OK for `Patterplay.Expr`.
//   package    the family's UPM package name, which a deferring family's
//              versionDefines test.
//   product    the family's name as a game developer knows it, for the skew
//              message.
//   deferTo    OMITTED for the host. For a deferring family, one entry per
//              family it defers to, in any order: { family: <repo>, version }.
//              `version` is the first release of that family's package that
//              carries a kernel this family can run on, written as a bare
//              version, which Unity reads as "at least" (an open range such
//              as "[0.14.0,)" never matches). The kernel assembly gets one
//              `!<HOST>_EXPR_OK` constraint per entry, so it compiles only when
//              none of its hosts is installed at a new enough version.
//
// A deferring family also gets a skew assembly per entry (Runtime/ExprSkew,
// <Prefix>.ExprSkew; with several entries, Runtime/ExprSkew/<Host>,
// <Prefix>.ExprSkew.<Host>): one C# file whose only line is an #error, compiled
// only when that host is installed but older than `version`, naming the fix. It
// is never referenced (autoReferenced false), and a family's dotnet test host
// must not compile it.
//
// A C#-only family deferring to both products is therefore:
//
//   { repo: "lockstep", unity: "lockstep/.../Runtime/Expr", unityTest: "...",
//     unityKernel: { assembly: "Lockstep.Expr", package: "<its UPM name>",
//       product: "Lockstep", deferTo: [{ family: "patter", version: "0.14.0" },
//       { family: "storylets", version: "<the first Storylet Engine with the kernel>" }] } }
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

const asmdefMeta = (rel) =>
  `fileFormatVersion: 2\nguid: ${unityGuid(rel)}\nAssemblyDefinitionImporter:\n` +
  `  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;

/** The define-symbol stem for a family's kernel: `Patterplay.Expr` -> `PATTERPLAY`. */
const kernelSymbol = (k) => k.assembly.replace(/\.Expr$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** A plain assembly definition, in the key order the editor writes. */
const asmdef = ({ name, rootNamespace, autoReferenced, defineConstraints, versionDefines }) =>
  JSON.stringify({
    name,
    rootNamespace,
    references: [],
    includePlatforms: [],
    excludePlatforms: [],
    allowUnsafeCode: false,
    overrideReferences: false,
    precompiledReferences: [],
    autoReferenced,
    defineConstraints,
    versionDefines,
    noEngineReferences: true,
  }, null, 2) + "\n";

/**
 * The files a family's `unityKernel` writes, as [path from the repos' parent, text]: the
 * kernel assembly definition beside the vendored kernel, and, for a deferring family, one
 * skew assembly per family it defers to. Each with its .meta.
 */
const kernelAssemblies = (family) => {
  const k = family.unityKernel;
  if (!k) throw new Error(`${family.repo}: a family with a \`unity\` target needs a \`unityKernel\``);
  const hosts = (k.deferTo ?? []).map(({ family: repo, version }) => {
    const host = families.find((f) => f.repo === repo)?.unityKernel;
    if (!host) throw new Error(`${family.repo}: defers to '${repo}', which has no unityKernel`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      // Unity reads a bare version as "at least"; a range such as "[0.14.0,)" never matches.
      throw new Error(`${family.repo}: defers to '${repo}' at '${version}', which is not a bare x.y.z version`);
    }
    return { ...host, version, symbol: kernelSymbol(host) };
  });
  const kernelPath = `${family.unity}/${k.assembly}.asmdef`;
  const out = [
    [kernelPath, asmdef({
      name: k.assembly,
      rootNamespace: "Wildwinter.Expr",
      autoReferenced: true,
      defineConstraints: hosts.map((h) => `!${h.symbol}_EXPR_OK`),
      versionDefines: hosts.map((h) => ({ name: h.package, expression: h.version, define: `${h.symbol}_EXPR_OK` })),
    })],
    [`${kernelPath}.meta`, asmdefMeta(kernelPath)],
  ];
  if (hosts.length === 0) return out;
  const skewRoot = `${path.posix.dirname(family.unity)}/ExprSkew`;
  out.push([`${skewRoot}.meta`, folderMeta(skewRoot)]);
  for (const h of hosts) {
    const prefix = h.assembly.replace(/\.Expr$/, "");
    const [dir, name] = hosts.length === 1
      ? [skewRoot, `${k.assembly}Skew`]
      : [`${skewRoot}/${prefix}`, `${k.assembly}Skew.${prefix}`];
    if (dir !== skewRoot) out.push([`${dir}.meta`, folderMeta(dir)]);
    out.push(
      [`${dir}/${name}.asmdef`, asmdef({
        name,
        rootNamespace: "",
        autoReferenced: false,
        defineConstraints: [`${h.symbol}_PRESENT`, `!${h.symbol}_EXPR_OK`],
        versionDefines: [
          { name: h.package, expression: "", define: `${h.symbol}_PRESENT` },
          { name: h.package, expression: h.version, define: `${h.symbol}_EXPR_OK` },
        ],
      })],
      [`${dir}/${name}.asmdef.meta`, asmdefMeta(`${dir}/${name}.asmdef`)],
      [`${dir}/ExprSkew.cs`,
        `#error ${k.product} needs ${h.product} ${h.version} or newer when both are installed, ` +
        `because they share one expression kernel. Update ${h.product}.\n`],
      [`${dir}/ExprSkew.cs.meta`, fileMeta(`${dir}/ExprSkew.cs`)],
    );
  }
  return out;
};

const root = fileURLToPath(new URL("..", import.meta.url));

/** The C++ kernel: every header here is vendored byte-identical into each family's
 *  `unreal` folder, and all of them together are hashed into the kernel id. */
const unrealKernel = [
  "Errors.h", "Fwd.h", "Value.h", "OrderedMap.h", "Ast.h", "Expr.h",
  "Specificity.h", "Mulberry32.h", "PropertyBag.h", "StateLogger.h", "ScopeRegistry.h",
];

/** The kernel id: the first 32 bits of a SHA-256 over each kernel header's name and its
 *  shared source (before stamping), in the order above. Content-addressed, so it changes
 *  exactly when the kernel does, and it is the same in every family by construction. */
const kernelHash = (() => {
  const h = createHash("sha256");
  for (const name of unrealKernel) {
    h.update(`${name}\0`).update(readFileSync(path.join(root, "ports/unreal", name), "utf8")).update("\0");
  }
  return h.digest("hex").slice(0, 8);
})();
const kernelSubs = { __EXPR_KERNEL_ID__: `k${kernelHash}`, __EXPR_KERNEL_HASH__: `0x${kernelHash}` };
const parent = path.resolve(root, "..");
const check = process.argv.includes("--check");

/**
 * The consuming families. `gd`, `tooling` and `cppTest` are the substitutions stamped
 * into that family's copies at copy time; the C++ and C# kernels take none.
 *
 * Every target is OPTIONAL. A family names the engines it ships (`godot`, `unreal`,
 * `unity`), the test hosts that run the shared corpora on them (`godotTest`,
 * `unrealTest`, `unityTest`), and whether it takes the shared release scripts
 * (`tooling`); a source whose target a family leaves out is simply not copied there.
 * A C#-only family is therefore a few lines: `repo`, `unity`, `unityTest`, and
 * `unityKernel` (see the header).
 */
const families = [
  {
    repo: "storylets",
    godot: "storylets/ports/godot/addons/storyletengine/runtime/expr",
    unreal: "storylets/ports/unreal/StoryletEngine/Source/StoryletEngineRuntime/Public/Storylets/Expr",
    unity: "storylets/ports/unity/StoryletEngine/Runtime/Expr",
    godotTest: "storylets/ports/godot/test",
    unrealTest: "storylets/ports/unreal/TestHost",
    unityTest: "storylets/ports/unity/TestHost",
    // Defers to Patterplay: 0.14.0 is the first Patterplay carrying the kernel.
    unityKernel: {
      assembly: "StoryletEngine.Expr",
      package: "com.storylet-studio.storyletengine",
      product: "The Storylet Engine",
      deferTo: [{ family: "patter", version: "0.14.0" }],
    },
    // GDScript names: the family's class_name shims, for the shared sources' messages.
    gd: { __EXPR_BAG_LABEL__: "StoryletPropertyBag", __EXPR_REGISTRY_LABEL__: "StoryletScopeRegistry" },
    tooling: {
      __EXPR_LOCKSTEP__: "@storylet-studio/runtime,@storylet-studio/play-helpers",
      __EXPR_FAMILY__: "Storylet Engine",
      __EXPR_UE_DEMO__: "StoryletEngineDemo",
    },
    // C++ test code only (the kernel headers take no per-family substitution): where the
    // registry corpus runner finds the family's copy of the kernel.
    cppTest: { __EXPR_SCOPEREGISTRY_HEADER__: '"Storylets/Expr/ScopeRegistry.h"' },
  },
  {
    repo: "patter",
    godot: "patter/ports/godot/addons/patterplay/runtime/expr",
    unreal: "patter/ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/Expr",
    unity: "patter/ports/unity/Patterplay/Runtime/Expr",
    godotTest: "patter/ports/godot/test",
    unrealTest: "patter/ports/unreal/TestHost",
    unityTest: "patter/ports/unity/TestHost",
    // Hosts the kernel: its kernel assembly always compiles.
    unityKernel: { assembly: "Patterplay.Expr", package: "com.patterkit.patterplay", product: "Patterplay" },
    // GDScript names: the family's class_name shims, for the shared sources' messages.
    gd: { __EXPR_BAG_LABEL__: "PatterPropertyBag", __EXPR_REGISTRY_LABEL__: "PatterScopeRegistry" },
    tooling: {
      __EXPR_LOCKSTEP__: "@patterkit/runtime",
      __EXPR_FAMILY__: "Patterplay",
      __EXPR_UE_DEMO__: "PatterplayDemo",
    },
    // C++ test code only (the kernel headers take no per-family substitution): where the
    // registry corpus runner finds the family's copy of the kernel.
    cppTest: { __EXPR_SCOPEREGISTRY_HEADER__: '"Patter/Expr/ScopeRegistry.h"' },
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
  { target: "godot", from: "ports/godot/values.gd", to: (f) => `${f.godot}/values.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/expr_eval.gd", to: (f) => `${f.godot}/expr_eval.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/expr_specificity.gd", to: (f) => `${f.godot}/expr_specificity.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/mulberry32.gd", to: (f) => `${f.godot}/mulberry32.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/property_bag.gd", to: (f) => `${f.godot}/property_bag.gd`, comment: "#", subs: (f) => f.gd },
  { target: "godot", from: "ports/godot/state_logger.gd", to: (f) => `${f.godot}/state_logger.gd`, comment: "#", subs: (f) => f.gd },
  { target: "godot", from: "ports/godot/bundle_view.gd", to: (f) => `${f.godot}/bundle_view.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/bundle_import_plugin.gd", to: (f) => `${f.godot}/bundle_import_plugin.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/bundle_export_plugin.gd", to: (f) => `${f.godot}/bundle_export_plugin.gd`, comment: "#" },
  { target: "godot", from: "ports/godot/scope_registry.gd", to: (f) => `${f.godot}/scope_registry.gd`, comment: "#", subs: (f) => f.gd },
  // The C++ kernel: byte-identical in every family, stamped only with the kernel id.
  ...unrealKernel.map((name) => (
    { target: "unreal", from: `ports/unreal/${name}`, to: (f) => `${f.unreal}/${name}`, comment: "//", subs: () => kernelSubs }
  )),
  // The C# kernel: byte-identical in every family. `subs` is empty, which still refuses a
  // file with a placeholder left in it.
  { target: "unity", from: "ports/unity/Errors.cs", to: (f) => `${f.unity}/Errors.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/Value.cs", to: (f) => `${f.unity}/Value.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/Ast.cs", to: (f) => `${f.unity}/Ast.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/Expr.cs", to: (f) => `${f.unity}/Expr.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/Specificity.cs", to: (f) => `${f.unity}/Specificity.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/Mulberry32.cs", to: (f) => `${f.unity}/Mulberry32.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/OrderedMap.cs", to: (f) => `${f.unity}/OrderedMap.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/PropertyBag.cs", to: (f) => `${f.unity}/PropertyBag.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/StateLogger.cs", to: (f) => `${f.unity}/StateLogger.cs`, comment: "//", subs: () => ({}) },
  { target: "unity", from: "ports/unity/ScopeRegistry.cs", to: (f) => `${f.unity}/ScopeRegistry.cs`, comment: "//", subs: () => ({}) },
  // The registry corpus runners (test code, never shipped): each family's test host runs
  // packages/scoperegistry/corpus.json, vendored beside its own corpus, through these.
  { target: "godotTest", from: "ports/godot/testing/registry_corpus.gd", to: (f) => `${f.godotTest}/registry_corpus.gd`, comment: "#", subs: (f) => f.gd },
  { target: "unrealTest", from: "ports/unreal/testing/RegistryCorpus.h", to: (f) => `${f.unrealTest}/RegistryCorpus.h`, comment: "//", subs: (f) => ({ ...kernelSubs, ...f.cppTest }) },
  { target: "unityTest", from: "ports/unity/testing/RegistryCorpus.cs", to: (f) => `${f.unityTest}/RegistryCorpus.cs`, comment: "//", subs: () => ({}) },
  // The repos' own release tooling. Not a port, but the same argument applies and the
  // numbers are worse: 99% and 100% identical once family names are normalised, and a
  // bug in the guard had to be fixed in both copies within an hour of the second being
  // written. The duplication scanner could not see either file until it was taught to
  // look at scripts/ on the same day.
  { target: "tooling", from: "tooling/release-guard.mjs", to: (f) => `${f.repo}/scripts/release-guard.mjs`, comment: "//", subs: (f) => f.tooling },
  { target: "tooling", from: "tooling/check-unreal-plugin.sh", to: (f) => `${f.repo}/scripts/check-unreal-plugin.sh`, comment: "#", subs: (f) => f.tooling, exec: true },
];

const banner = (rel, c) =>
  `${c} GENERATED - vendored from expr/${rel} by scripts/vendor-ports.mjs.\n` +
  `${c} Do not edit here; edit the shared source and re-run the script.\n`;

let drifted = 0;
let skipped = 0;

console.log(`C++ kernel id: ${kernelSubs.__EXPR_KERNEL_ID__}`);

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
    // A target the family does not have (an engine it does not ship, release scripts it
    // does not share) is not a gap: that source is simply not the family's.
    if (!family[src.target]) continue;
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

  // Unity .meta sidecars for the vendored C# and its folder, and the family's kernel
  // assembly definitions (see the header).
  if (family.unity) {
    // New vendored files get a path-derived GUID. OrderedMap, PropertyBag, and StateLogger
    // predate this list and carry GUIDs minted by the editor; they are left as they are,
    // since changing a GUID breaks every reference to it.
    const files = [
      [`${family.unity}.meta`, folderMeta(`${family.unity}`)],
      [`${family.unity}/Errors.cs.meta`, fileMeta(`${family.unity}/Errors.cs`)],
      [`${family.unity}/Value.cs.meta`, fileMeta(`${family.unity}/Value.cs`)],
      [`${family.unity}/Ast.cs.meta`, fileMeta(`${family.unity}/Ast.cs`)],
      [`${family.unity}/Expr.cs.meta`, fileMeta(`${family.unity}/Expr.cs`)],
      [`${family.unity}/Specificity.cs.meta`, fileMeta(`${family.unity}/Specificity.cs`)],
      [`${family.unity}/Mulberry32.cs.meta`, fileMeta(`${family.unity}/Mulberry32.cs`)],
      [`${family.unity}/ScopeRegistry.cs.meta`, fileMeta(`${family.unity}/ScopeRegistry.cs`)],
      ...kernelAssemblies(family),
    ];
    for (const [rel, want] of files) {
      const dest = path.join(parent, rel);
      const have = existsSync(dest) ? readFileSync(dest, "utf8") : null;
      if (have === want) { console.log(`ok     ${rel}`); continue; }
      if (check) { console.error(`DRIFT  ${rel} ${have === null ? "(missing)" : "(differs)"}`); drifted++; }
      else { mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, want); console.log(`wrote  ${rel}`); }
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
