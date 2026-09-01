import { describe, expect, it } from "vitest";
import { newId, slug, fnv32, parseSource, findMatcher } from "../src/index.js";
import { isUnsafeEntry, escapesTarget, ARCHIVE_ENTRY_OPTS } from "../src/archive.js";

describe("newId", () => {
  it("prefixes, and is the requested length", () => {
    expect(newId("scn")).toMatch(/^scn_[0-9a-z]{8}$/);
    expect(newId("", 12)).toMatch(/^[0-9a-z]{12}$/);
  });
  it("does not collide across a large sample", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(seen.size).toBe(5000);
  });
  it("draws from the WHOLE alphabet uniformly, which is what rejection sampling buys", () => {
    // Dropping the `b >= limit` guard does NOT drop characters, it skews four of
    // them: 256 = 7*36 + 4, so bytes 252-255 fold onto 0-3 and those appear 8/7
    // as often. A "every character shows up" check passes happily on that, and a
    // loose max/min ratio does too (8/7 is 1.14, inside sampling noise at small
    // N). So: chi-squared against uniform, with enough draws to separate them.
    // Unbiased lands near 35 (the degrees of freedom); biased lands near 195.
    const chars = [...Array.from({ length: 12500 }, () => newId("", 8)).join("")];
    const counts = new Map<string, number>();
    for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(36);

    const expected = chars.length / 36;
    const chi2 = [...counts.values()]
      .reduce((acc, n) => acc + ((n - expected) ** 2) / expected, 0);
    expect(chi2).toBeLessThan(100);
  });
});

describe("slug", () => {
  it("lowercases, collapses punctuation, and trims dashes", () => {
    expect(slug("Torin's Offer!")).toBe("torin-s-offer");
    expect(slug("  The Hamlet  ")).toBe("the-hamlet");
  });
  it("falls back when nothing usable is left", () => {
    expect(slug("!!!")).toBe("project");
    expect(slug("!!!", "untitled")).toBe("untitled");
  });
});

describe("fnv32", () => {
  it("is stable, which is the only property that matters", () => {
    expect(fnv32("")).toBe(0x811c9dc5);
    expect(fnv32("a")).toBe(fnv32("a"));
    expect(fnv32("a")).not.toBe(fnv32("b"));
  });
  it("stays inside uint32", () => {
    for (const s of ["", "a", "hello world", "\u2019", "x".repeat(1000)]) {
      const h = fnv32(s);
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    }
  });
});

describe("parseSource", () => {
  it("reads JSON5", () => {
    expect(parseSource("{ a: 1, /* trailing */ b: [2,], }")).toEqual({ a: 1, b: [2] });
  });
  it("tolerates a leading BOM, which JSON5 alone will not", () => {
    expect(parseSource("\uFEFF{ a: 1 }")).toEqual({ a: 1 });
  });
  it("throws on malformed input rather than returning undefined", () => {
    expect(() => parseSource("{ not json at all")).toThrow();
  });
});

describe("findMatcher", () => {
  it("is null for an empty query", () => {
    expect(findMatcher({ query: "" })).toBeNull();
  });
  it("ESCAPES the query: `a.b` means those three characters", () => {
    const m = findMatcher({ query: "a.b" })!;
    expect("axb".replace(m, "!")).toBe("axb");
    expect("a.b".replace(m, "!")).toBe("!");
  });
  it("is global, so every occurrence is replaced", () => {
    expect("x x x".replace(findMatcher({ query: "x" })!, "y")).toBe("y y y");
  });
  it("is case-insensitive unless asked", () => {
    expect("AbC".replace(findMatcher({ query: "abc" })!, "!")).toBe("!");
    expect("AbC".replace(findMatcher({ query: "abc", caseSensitive: true })!, "!")).toBe("AbC");
  });
  it("honours wholeWord", () => {
    const m = findMatcher({ query: "cat", wholeWord: true })!;
    expect("cat concat".replace(m, "!")).toBe("! concat");
  });
});

// The guard that matters. Both families had a correct copy, which is the state
// before a drift rather than proof there will not be one.
describe("archive entry guards", () => {
  it("refuses absolute and drive-lettered names", () => {
    expect(isUnsafeEntry("/etc/passwd")).toBe(true);
    expect(isUnsafeEntry("C:\\windows\\system32")).toBe(true);
  });
  it("refuses names that climb out", () => {
    expect(isUnsafeEntry("..")).toBe(true);
    expect(isUnsafeEntry("../x")).toBe(true);
    expect(isUnsafeEntry("a/../../x")).toBe(true);
  });
  it("allows ordinary nested names", () => {
    expect(isUnsafeEntry("a/b/c.txt")).toBe(false);
    expect(isUnsafeEntry("a/../b.txt")).toBe(false);   // normalises to b.txt
  });

  it("escapesTarget catches what a name check alone would miss", () => {
    expect(escapesTarget("/tmp/target", "../evil")).toBe(true);
    expect(escapesTarget("/tmp/target", "a/../../evil")).toBe(true);
    expect(escapesTarget("/tmp/target", "a/b.txt")).toBe(false);
  });
  it("is not fooled by a SIBLING whose name starts with the target's", () => {
    // The classic startsWith bug: /tmp/target-evil is not inside /tmp/target.
    expect(escapesTarget("/tmp/target", "../target-evil/x")).toBe(true);
  });
  it("treats the target itself as outside: there is no file to write there", () => {
    expect(escapesTarget("/tmp/target", ".")).toBe(true);
    expect(escapesTarget("/tmp/target", "")).toBe(true);
  });
});

describe("archive determinism", () => {
  it("pins a FIXED entry date, never now", () => {
    expect(ARCHIVE_ENTRY_OPTS.date.toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });
  it("writes no folder entries, whose presence and order vary by writer", () => {
    expect(ARCHIVE_ENTRY_OPTS.createFolders).toBe(false);
  });
});
