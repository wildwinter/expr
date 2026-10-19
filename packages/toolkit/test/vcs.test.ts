import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VCS_KINDS, bundlePostureOf, ignoreFileFor, isVcsKind, runMergetool, vcsConfigFiles } from "../src/vcs.js";
import type { VcsFile, VcsFormat, VcsKind } from "../src/vcs.js";

/** A format with every optional part, shaped like the two that use this. */
const FORMAT: VcsFormat = {
  product: "Fable", tool: "fable", driver: "fables",
  source: ["fableproj", "fabledeck"],
  manifest: { dir: "extensions", suffix: ".extension.json" },
  bundle: "fablec", pack: "fablepack", conflict: "fableconflict",
  binary: [{ pattern: "assets/**", note: "Pictures: bytes." }],
};

const file = (files: VcsFile[], path: string): string | undefined => files.find((f) => f.path === path)?.content;
const lines = (text: string | undefined): string[] => (text ?? "").split("\n").map((l) => l.replace(/\s+/g, " ").trim());

describe("the files a project is set up with", () => {
  it("git: every source shard pinned to LF and merged by the driver; the bundle ours, the document binary", () => {
    const attrs = lines(file(vcsConfigFiles(FORMAT, "git"), ".gitattributes"));
    for (const ext of FORMAT.source) {
      expect(attrs).toContain(`*.${ext} text eol=lf`);
      expect(attrs).toContain(`*.${ext} merge=fables`);
    }
    expect(attrs).toContain("*.fablec text eol=lf merge=ours");
    expect(attrs).toContain("*.fablepack binary");
    expect(attrs).toContain("extensions/*.extension.json text eol=lf");
    expect(attrs).toContain("assets/** binary");
    expect(attrs).toContain("# Pictures: bytes.");
  });

  it("the bundle posture decides the ignore file: commit ignores the document and sidecar only", () => {
    const commit = lines(file(vcsConfigFiles(FORMAT, "git"), ".gitignore"));
    expect(commit).toContain("*.fablepack");
    expect(commit).toContain("*.fableconflict");
    expect(commit).not.toContain("*.fablec");
    expect(lines(file(vcsConfigFiles(FORMAT, "git", "ignore"), ".gitignore"))).toContain("*.fablec");
  });

  it("each system gets its own ignore file; SVN keeps its ignores in a property, so none", () => {
    const expected: Record<VcsKind, string | undefined> = { git: ".gitignore", perforce: ".p4ignore", plastic: "ignore.conf", svn: undefined };
    for (const vcs of VCS_KINDS) {
      expect(ignoreFileFor(vcs)).toBe(expected[vcs]);
      const paths = vcsConfigFiles(FORMAT, vcs).map((f) => f.path).sort();
      expect(paths).toEqual(["vcs-setup.md", ...(vcs === "git" ? [".gitattributes"] : []), ...(expected[vcs] ? [expected[vcs]!] : [])].sort());
    }
  });

  it("the guide is tailored to the system, and carries every system when none is chosen", () => {
    const guide = (vcs?: VcsKind): string => file(vcsConfigFiles(FORMAT, vcs), "vcs-setup.md")!;
    expect(guide("git")).toContain('git config merge.fables.driver "fable merge %O %A %B -o %A --path %P"');
    expect(guide("git")).not.toContain("## Perforce");
    expect(guide("perforce")).toContain("text   //....fabledeck");
    expect(guide("perforce")).toContain("text   //....extension.json");
    expect(guide("perforce")).toContain("binary //....fablepack");
    expect(guide("perforce")).toContain("fable mergetool --fallback");
    expect(guide("plastic")).toContain("@basefile @sourcefile @destinationfile @output");
    expect(guide("svn")).toContain("*.fabledeck = svn:eol-style=LF");
    expect(guide("svn")).toContain('svn propset svn:ignore "*.fablepack\\n*.fableconflict" .');
    expect(file(vcsConfigFiles(FORMAT, "svn", "ignore"), "vcs-setup.md")).toContain('"*.fablepack\\n*.fablec\\n*.fableconflict"');
    const none = guide(undefined);
    for (const heading of ["## git", "## Perforce", "## Plastic SCM", "## SVN"]) expect(none).toContain(heading);
    expect(vcsConfigFiles(FORMAT, undefined).map((f) => f.path)).toEqual(["vcs-setup.md"]);
  });

  it("a format without manifests or extra binaries says nothing about them", () => {
    const bare: VcsFormat = { ...FORMAT, manifest: undefined, binary: undefined };
    const attrs = file(vcsConfigFiles(bare, "git"), ".gitattributes")!;
    expect(attrs).not.toContain("extension.json");
    expect(attrs).not.toContain("assets");
  });

  it("no line in any file is left with an unfilled placeholder", () => {
    for (const vcs of [...VCS_KINDS, undefined]) {
      for (const posture of ["commit", "ignore"] as const) {
        for (const f of vcsConfigFiles(FORMAT, vcs, posture)) expect(f.content).not.toMatch(/undefined|\$\{/);
      }
    }
  });
});

describe("the bundle posture, read back", () => {
  it("round-trips for every system, SVN through the guide", () => {
    for (const vcs of [...VCS_KINDS, undefined]) {
      for (const posture of ["commit", "ignore"] as const) {
        const files = vcsConfigFiles(FORMAT, vcs, posture);
        expect(bundlePostureOf(FORMAT, vcs, (p) => file(files, p)), `${vcs ?? "none"} / ${posture}`).toBe(posture);
      }
    }
  });

  it("a project with none of the files reads as committing its bundle", () => {
    expect(bundlePostureOf(FORMAT, "git", () => undefined)).toBe("commit");
  });
});

describe("isVcsKind", () => {
  it("takes the four systems and nothing else", () => {
    for (const vcs of VCS_KINDS) expect(isVcsKind(vcs)).toBe(true);
    for (const other of ["none", "hg", "", undefined, 3]) expect(isVcsKind(other)).toBe(false);
  });
});

describe("runMergetool", () => {
  const dir = mkdtempSync(join(tmpdir(), "toolkit-mergetool-"));
  const paths = { base: join(dir, "b.txt"), theirs: join(dir, "t.txt"), ours: join(dir, "o.txt"), out: join(dir, "out.txt") };
  const errors: string[] = [];
  const base = { ...paths, tool: "fable", error: (m: string) => { errors.push(m); } };

  it("sends the format's source to the structured merge, by the output's name or ours's", () => {
    let merged = 0;
    const merge = (): number => { merged++; return 1; };
    expect(runMergetool({ ...base, out: join(dir, "x.fabledeck"), isSource: (p) => p.endsWith(".fabledeck"), merge })).toBe(1);
    expect(runMergetool({ ...base, ours: join(dir, "y.fabledeck"), isSource: (p) => p.endsWith(".fabledeck"), merge })).toBe(1);
    expect(merged).toBe(2);
  });

  it("hands anything else to the fallback, BASE THEIRS OURS OUT, and returns its exit code", () => {
    const record = join(dir, "argv.json");
    const script = join(dir, "fallback.cjs");
    writeFileSync(script, `require("fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2))); process.exit(3);`);
    const code = runMergetool({ ...base, fallback: `${process.execPath} ${script}`, isSource: () => false, merge: () => 0 });
    expect(code).toBe(3);
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual([paths.base, paths.theirs, paths.ours, paths.out]);
  });

  it("with no fallback, refuses with 2 and says why", () => {
    errors.length = 0;
    expect(runMergetool({ ...base, isSource: () => false, merge: () => 0 })).toBe(2);
    expect(errors[0]).toContain("no --fallback");
  });

  it("a fallback that cannot start is 1, named", () => {
    errors.length = 0;
    expect(runMergetool({ ...base, fallback: "no-such-merge-tool-anywhere", isSource: () => false, merge: () => 0 })).toBe(1);
    expect(errors[0]).toContain("no-such-merge-tool-anywhere");
  });
});
