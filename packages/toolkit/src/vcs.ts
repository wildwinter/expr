// ---------------------------------------------------------------------------
// Version-control setup for a project: the files `init` writes for the team's
// version control system, the bundle posture, and the `mergetool` wrapper a
// system with one global merge tool calls.
//
// Lifted from Patter (patter/packages/ops/src/init.ts and the CLI's
// `mergetool`), where git, Perforce, Plastic SCM and SVN were all covered, so
// the Storylet format takes the same support rather than a second copy of it
// (patterkit design/family-parity-2026-10.md item 13). Each format says what
// it is called and what its files are; the rules and the words are shared.
//
// A subpath of its own because `runMergetool` starts the fallback tool, which
// needs `node:child_process`; the rest is plain text.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/** The version control systems a project can be set up for. */
export const VCS_KINDS = ["git", "perforce", "plastic", "svn"] as const;
export type VcsKind = typeof VCS_KINDS[number];

export const isVcsKind = (value: unknown): value is VcsKind =>
  typeof value === "string" && (VCS_KINDS as readonly string[]).includes(value);

/** What each system is called to a person, for pickers and messages. */
export const VCS_LABELS: Readonly<Record<VcsKind, string>> = {
  git: "Git", perforce: "Perforce", plastic: "Plastic SCM", svn: "Subversion (SVN)",
};

/** Whether the compiled bundle is committed, or built in CI and ignored. */
export type BundlePosture = "commit" | "ignore";

/** What a format is called and what its files are. Extensions are without the dot. */
export interface VcsFormat {
  /** What the guide calls the source: "Patter", "Storylet Studio". */
  readonly product: string;
  /** The command-line tool: "patter", "storyletengine". */
  readonly tool: string;
  /** The git merge driver's name, as `.gitattributes` names it: "patter", "storylets". */
  readonly driver: string;
  /** The source shards' extensions: UTF-8 + LF text, merged by the structured merge. */
  readonly source: readonly string[];
  /** An extension manifest's suffix (`.extension.json`), and the folder that holds them: text, merged as text. */
  readonly manifest?: { readonly dir: string; readonly suffix: string };
  /** The compiled bundle's extension: regenerated, never hand-merged. */
  readonly bundle: string;
  /** The packed document's extension: a binary zip, kept out of version control. */
  readonly pack: string;
  /** The unresolved-merge sidecar's extension: never committed. */
  readonly conflict: string;
  /** Further binary paths for git, each with the line saying why (`assets/**`). */
  readonly binary?: readonly { readonly pattern: string; readonly note: string }[];
}

/** One file to write, relative to the project folder. */
export interface VcsFile {
  readonly path: string;
  readonly content: string;
}

/** The setup guide every project gets, whatever its system. */
export const VCS_SETUP_FILE = "vcs-setup.md";

/** The ignore file a system reads, or undefined for one that keeps its ignores elsewhere (SVN: a property). */
export function ignoreFileFor(vcs: VcsKind | undefined): string | undefined {
  switch (vcs) {
    case "git": return ".gitignore";
    case "perforce": return ".p4ignore";
    case "plastic": return "ignore.conf";
    default: return undefined;
  }
}

/**
 * The files a project is set up with for `vcs`: the setup guide always, git's
 * `.gitattributes`, and the system's ignore file. With no system, the guide
 * carries every system's section and nothing else is written.
 *
 * Shared by `init` and an editor's switch of system, which writes these for the
 * new one and removes what the old one's list holds that this one's does not.
 */
export function vcsConfigFiles(format: VcsFormat, vcs: VcsKind | undefined, bundle: BundlePosture = "commit"): VcsFile[] {
  const files: VcsFile[] = [{ path: VCS_SETUP_FILE, content: vcsSetup(format, vcs, bundle) }];
  if (vcs === "git") files.push({ path: ".gitattributes", content: gitAttributes(format) });
  const ignore = ignoreFileFor(vcs);
  if (ignore !== undefined) files.push({ path: ignore, content: ignoreContent(format, bundle) });
  return files;
}

/**
 * The bundle posture a project was set up with, read back from the files
 * `vcsConfigFiles` wrote: the ignore file naming the bundle, else the guide
 * saying the project ignores it (SVN keeps its ignores in a property). "commit"
 * when neither says so. `read` returns a project-relative file's text, or
 * undefined when it is not there.
 *
 * A switch of system re-writes the files, and always writing "commit" lost the
 * ignore rule of a project set up to ignore its bundle (Patter, before this).
 */
export function bundlePostureOf(format: VcsFormat, vcs: VcsKind | undefined, read: (path: string) => string | undefined): BundlePosture {
  const ignore = ignoreFileFor(vcs);
  if (ignore !== undefined && (read(ignore) ?? "").split(/\r?\n/).some((l) => l.trim() === `*.${format.bundle}`)) return "ignore";
  return (read(VCS_SETUP_FILE) ?? "").includes(IGNORES_MARK) ? "ignore" : "commit";
}

// --- the files -----------------------------------------------------------------

const IGNORES_MARK = "This project IGNORES the compiled";

const column = (patterns: readonly string[]): number => Math.max(...patterns.map((p) => p.length)) + 1;

function gitAttributes(f: VcsFormat): string {
  const source = f.source.map((ext) => `*.${ext}`);
  const manifest = f.manifest !== undefined ? `${f.manifest.dir}/*${f.manifest.suffix}` : undefined;
  // Aligned on the extension patterns; a longer path pattern takes one space.
  const w = column([...source, `*.${f.bundle}`, `*.${f.pack}`]);
  const row = (pattern: string, attrs: string): string => `${pattern.padEnd(w)}${pattern.length >= w ? " " : ""}${attrs}`;
  const blocks = [
    `# ${f.product} source is UTF-8 + LF text (pinned; never let autocrlf touch it).\n`
      + source.map((p) => row(p, "text eol=lf")).join("\n"),
    `# Id-keyed structured merge for ${f.product} source (the '${f.tool} merge' driver).\n`
      + `# Register it once per clone (see ${VCS_SETUP_FILE}); until then git falls back to a\n`
      + `# normal text merge for these: no harm, just not structure-aware.\n`
      + source.map((p) => row(p, `merge=${f.driver}`)).join("\n"),
  ];
  if (manifest !== undefined) {
    blocks.push(`# An extension's manifest is the extension's own JSON, kept in the project so\n`
      + `# every machine reads the same one, and never edited here: text, merged as text.\n`
      + row(manifest, "text eol=lf"));
  }
  blocks.push(`# Generated artifacts. The compiled bundle is committed but REGENERATED, never\n`
    + `# hand-merged: keep ours on conflict and rebuild ('${f.tool} validate' catches a\n`
    + `# stale one). Needs a one-time 'git config merge.ours.driver true' (see ${VCS_SETUP_FILE}).\n`
    + row(`*.${f.bundle}`, "text eol=lf merge=ours") + "\n"
    + `# The packed document is a binary zip envelope, kept out of version control (.gitignore).\n`
    + row(`*.${f.pack}`, "binary"));
  for (const b of f.binary ?? []) blocks.push(`${b.note.split("\n").map((l) => `# ${l}`).join("\n")}\n${row(b.pattern, "binary")}`);
  return blocks.join("\n\n") + "\n";
}

function ignoreContent(f: VcsFormat, bundle: BundlePosture): string {
  const lines = [
    `# ${f.product} generated artifacts: not source (see ${VCS_SETUP_FILE}).`,
    "# Packed document (the send-and-return envelope):",
    `*.${f.pack}`,
    "# Unresolved merge sidecar (a lingering one is a validate error). The merge also names its clashes",
    "# in the shard itself, under \"unresolved\", which IS committed with the file, so CI refuses an",
    "# unresolved merge wherever it goes:",
    `*.${f.conflict}`,
  ];
  if (bundle === "ignore") lines.push("# Compiled bundle (built in CI, not committed under this posture):", `*.${f.bundle}`);
  return lines.join("\n") + "\n";
}

function vcsSetup(f: VcsFormat, vcs: VcsKind | undefined, bundle: BundlePosture): string {
  const text = [...f.source, ...(f.manifest !== undefined ? [f.manifest.suffix.replace(/^\./, "")] : []), f.bundle];
  const sections: Record<VcsKind, string> = {
    git: `## git

\`.gitattributes\` (already emitted) pins ${f.product} source shards to UTF-8 + LF
text and marks the generated artifacts (the \`.${f.bundle}\` bundle \`merge=ours\`, the
\`.${f.pack}\` document \`binary\`). \`.gitignore\` (already emitted) keeps the document
(and the bundle, under the "ignore" posture) out of source control.

Recommended pre-commit hook (\`.git/hooks/pre-commit\`, executable):

    #!/bin/sh
    ${f.tool} validate || exit 1

The \`merge=${f.driver}\` rules in \`.gitattributes\` are already active; register the
drivers once per clone (git config is not repo-tracked). Until then git falls
back to a normal text merge for those files:

    git config merge.${f.driver}.name "${f.product} structured merge"
    git config merge.${f.driver}.driver "${f.tool} merge %O %A %B -o %A --path %P"
    git config merge.ours.driver true

git calls the per-path driver directly (no \`mergetool\` wrapper needed). \`%O %A %B\`
are base, ours and theirs; the merged result is written back to \`%A\`, and \`%P\` is
the file's real path. On a conflict \`${f.tool} merge\` exits non-zero and writes a
\`.${f.conflict}\` sidecar beside that file, so the merge stays unresolved.
`,
    perforce: `## Perforce

Add ${f.product}'s extensions to the typemap (\`p4 typemap\`): source shards and
the compiled bundle are TEXT with LF; the packed document is BINARY:

${text.map((ext) => `    text   //....${ext}`).join("\n")}
    binary //....${f.pack}

On a unicode-mode server, set \`P4CHARSET=utf8\`. For a lock-based workflow (one
lock per file), add \`+l\` to make checkouts exclusive. A \`.p4ignore\` (already
emitted) keeps the packed document out of the depot.

Perforce allows ONE global merge tool, so set \`${f.tool} mergetool\` as it: it
runs the structured merge for ${f.product} source and hands everything else to
your normal tool. Map Perforce's variables into the order BASE THEIRS OURS OUT:

    ${f.tool} mergetool --fallback "<your merge tool>" %b %t %y %r

(\`%b\` base, \`%t\` theirs, \`%y\` yours, \`%r\` result: adjust to your P4 client's
variable names; the argument ORDER is what matters.)
`,
    plastic: `## Plastic SCM (Unity Version Control)

${f.product} source shards are plain UTF-8 text; Plastic handles them as they
are. The \`ignore.conf\` (already emitted) keeps the packed document out of the
repository. For a lock-based workflow, configure exclusive checkout (lock.conf)
for the shard extensions.

In Preferences > Merge tools, add an external tool (a global entry is fine: the
wrapper looks at each file's name) with the arguments in BASE THEIRS OURS OUT
order:

    ${f.tool} mergetool --fallback "<your merge tool>" @basefile @sourcefile @destinationfile @output
`,
    svn: `## SVN

Set auto-props so ${f.product} source keeps LF (\`~/.subversion/config\` or the
repository's config):

    [auto-props]
${text.map((ext) => `    *.${ext} = svn:eol-style=LF`).join("\n")}
    *.${f.pack} = svn:mime-type=application/octet-stream

SVN's ignore is a folder PROPERTY, not a file; set it from the project folder:

    svn propset svn:ignore "*.${f.pack}${bundle === "ignore" ? `\\n*.${f.bundle}` : ""}\\n*.${f.conflict}" .

For a lock-based workflow, add \`svn:needs-lock\` to the shard patterns.

SVN allows one global merge tool. Point \`[helpers] merge-tool-cmd\` at a small
wrapper script that passes SVN's four arguments (base, theirs, mine, merged: BASE
THEIRS OURS OUT) to \`${f.tool} mergetool\`:

    #!/bin/sh
    exec ${f.tool} mergetool --fallback "<your merge tool>" "$1" "$2" "$3" "$4"
`,
  };
  const head = vcs !== undefined
    ? sections[vcs]
    : `No version control system chosen (\`${f.tool} init --vcs ${VCS_KINDS.join("|")}\` writes
the setup for one). Whichever you adopt, the rules are the same: ${f.product} source
is UTF-8 + LF text, and \`${f.tool} validate\` belongs in your pre-commit hook and
CI. Sections for every supported system:

${VCS_KINDS.map((k) => sections[k]).join("\n")}`;
  return `# Version-control setup for this ${f.product} project\n\n${head}\n${bundleSection(f, bundle)}`;
}

function bundleSection(f: VcsFormat, bundle: BundlePosture): string {
  const posture = bundle === "commit"
    ? `This project COMMITS the compiled \`.${f.bundle}\` bundle (\`${f.tool} init --bundle ignore\`
builds it in CI instead). The bundle is regenerated, never hand-merged: on a
conflict, keep ours and run \`${f.tool} export\` again. \`${f.tool} validate\` works out
the bundle's hash from source and FAILS if it is stale, so a forgotten rebuild
cannot ship unnoticed.`
    : `${IGNORES_MARK} \`.${f.bundle}\` bundle (built in CI; \`${f.tool} init
--bundle commit\` commits it instead). Run \`${f.tool} export\` as a build step.`;
  return `## Compiled bundle and packed document

${posture}

The packed \`.${f.pack}\` document (\`${f.tool} pack\`) is the send-and-return envelope
for collaborators without version control. It is a binary zip and a projection of
the shards, NOT source, so it stays out of version control (ignored above); edits
come back with \`${f.tool} unpack\`.
`;
}

// --- mergetool -------------------------------------------------------------------

export interface MergetoolOptions {
  /** The four files, in the order every system with one global tool passes them. */
  readonly base: string;
  readonly theirs: string;
  readonly ours: string;
  readonly out: string;
  /** The team's ordinary merge tool, with any flags of its own ("code --wait --merge"). */
  readonly fallback?: string;
  /** Is this path the format's source? Asked of `out` and of `ours`. */
  readonly isSource: (path: string) => boolean;
  /** Run the structured merge of base, ours and theirs into `out`; its exit code. */
  readonly merge: () => number;
  /** Where to say what went wrong. */
  readonly error: (message: string) => void;
  /** The tool's name, for messages: "patter", "storyletengine". */
  readonly tool: string;
}

/**
 * The sniff-and-dispatch wrapper: one global external merge tool serves the
 * whole depot (Perforce, Plastic SCM and SVN allow only one). The format's
 * source goes to the structured merge; anything else goes to `fallback`, with
 * the four paths as separate arguments and no shell, so spaces and
 * metacharacters in them are safe. git does not need this: it calls the
 * per-path driver directly.
 *
 * Exit codes: the merge's, the fallback's, 1 when the fallback could not
 * start, 2 when a file is not the format's and no fallback is configured.
 */
export function runMergetool(o: MergetoolOptions): number {
  if (o.isSource(o.out) || o.isSource(o.ours)) return o.merge();
  if (o.fallback === undefined) {
    o.error(`${o.tool} mergetool: ${o.out} is not ${o.tool} source and no --fallback is configured`);
    return 2;
  }
  const [cmd, ...pre] = o.fallback.split(/\s+/).filter(Boolean);
  if (cmd === undefined) {
    o.error(`${o.tool} mergetool: --fallback is empty`);
    return 2;
  }
  const r = spawnSync(cmd, [...pre, o.base, o.theirs, o.ours, o.out], { stdio: "inherit" });
  // A tool that could not start (not installed, not on PATH) has no status: say so, or the merge just fails.
  if (r.error) {
    o.error(`${o.tool} mergetool: could not run the fallback '${cmd}': ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}
