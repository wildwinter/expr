// Shared game scopes (patterkit/design/shared-scopes.md): the editing side of one registry per game.
// Each tool writes its own file into the game's `game-scopes/` folder and reads the others; these are
// the pure functions every tool shares, so the tools cannot disagree about the format, the folder, or
// what a name means.

import { describe, expect, it } from "vitest";
import {
  GAME_SCOPES_DIR, declarationsOf, findGameScopes, mergeScopes, parseScopesFile, referenceNote,
  scopesCatalogue, scopesSchema, serialiseScopesFile, standInRegistry,
  type NamedScopesFile, type ScopesFile, type ScopesFs,
} from "../src/scopes.js";

const patter: ScopesFile = {
  version: 1, owner: "Patter",
  scopes: [{ token: "patter", declarations: [
    { name: "visits", type: "number", default: 0, purpose: "How often the guard has shouted" },
    { name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" },
  ] }],
};
const storylets: ScopesFile = {
  version: 1, owner: "Storylet Engine",
  scopes: [{ token: "story", declarations: [
    { name: "act", type: "quality", stages: ["one", "two", "three"], default: "one" },
    { name: "rumours", type: "number", default: 0, writable: false },
  ] }],
};
const game: ScopesFile = {
  version: 1, owner: "Game",
  scopes: [
    { token: "world", declarations: [{ name: "time_of_day", type: "string", default: "day" }] },
    { token: "system", writable: false, declarations: [{ name: "platform", type: "string", default: "pc" }] },
    { token: "telemetry" },   // opaque: any name, unchecked
  ],
};
const folder: NamedScopesFile[] = [
  { fileName: "storylets.scopes.json", file: storylets },
  { fileName: "patter.scopes.json", file: patter },
  { fileName: "game.scopes.json", file: game },
];

describe("parseScopesFile and serialiseScopesFile", () => {
  it("round-trips a file, and the text is canonical: the same content always writes the same bytes", () => {
    const text = serialiseScopesFile(patter);
    expect(text.endsWith("\n")).toBe(true);
    const { file, issues } = parseScopesFile(text, "patter.scopes.json");
    expect(issues).toEqual([]);
    expect(file).toEqual(patter);
    expect(serialiseScopesFile(file!)).toBe(text);
  });

  it("writes keys in one order whatever order the caller built them in", () => {
    const shuffled = JSON.parse(JSON.stringify({ scopes: patter.scopes, owner: "Patter", version: 1 })) as ScopesFile;
    expect(serialiseScopesFile(shuffled)).toBe(serialiseScopesFile(patter));
    expect(serialiseScopesFile(patter).indexOf('"version"')).toBeLessThan(serialiseScopesFile(patter).indexOf('"owner"'));
  });

  it("keeps only the fields the format knows", () => {
    const { file } = parseScopesFile(JSON.stringify({ ...patter, written: "2026-09-25", scopes: [{ ...patter.scopes[0], colour: "red" }] }), "p");
    expect(file).toEqual(patter);
  });

  it("reports what is wrong, naming the file, and never throws", () => {
    const bad = (text: string): string => {
      const { file, issues } = parseScopesFile(text, "x.scopes.json");
      expect(file).toBeUndefined();
      expect(issues).toHaveLength(1);
      expect(issues[0]!.file).toBe("x.scopes.json");
      expect(issues[0]!.severity).toBe("error");
      return issues[0]!.message;
    };
    expect(bad("{ nope")).toMatch(/^not valid JSON/);
    expect(bad("[]")).toBe("a scopes file is a JSON object");
    expect(bad(JSON.stringify({ ...patter, version: 2 }))).toBe("unsupported version 2 (this build reads 1)");
    expect(bad(JSON.stringify({ ...patter, owner: " " }))).toBe("owner must name who wrote the file");
    expect(bad(JSON.stringify({ ...patter, scopes: [{ token: "a b" }] }))).toMatch(/needs a token/);
    expect(bad(JSON.stringify({ ...patter, scopes: [{ token: "a" }, { token: "a" }] }))).toBe("scope '@a' is declared twice");
    expect(bad(JSON.stringify({ ...patter, scopes: [{ token: "a", declarations: [{ name: "x", type: "vector" }] }] })))
      .toBe("@a.x: type must be one of boolean, number, string, enum, flags, quality");
    expect(bad(JSON.stringify({ ...patter, scopes: [{ token: "a", declarations: [{ name: "x", type: "number" }, { name: "X", type: "number" }] }] })))
      .toBe("@a.X is declared twice");
  });
});

describe("findGameScopes", () => {
  /** A fake tree: the folders that exist, as absolute paths. */
  const tree = (...paths: string[]): ScopesFs => {
    const have = new Set(paths);
    return {
      exists: (p) => have.has(p),
      parent: (p) => (p === "/" ? undefined : p.slice(0, p.lastIndexOf("/")) || "/"),
      join: (d, n) => {
        const parts = (d === "/" ? [] : d.split("/").slice(1));
        for (const seg of n.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
        return "/" + parts.join("/");
      },
    };
  };

  it("walks up from the project, the project folder first, to the nearest game-scopes folder", () => {
    const fs = tree("/game/.git", "/game/game-scopes", "/game/story/village.patter");
    expect(findGameScopes("/game/story/village.patter", fs)).toEqual({ dir: "/game/game-scopes" });
    const own = tree("/game/.git", "/game/game-scopes", "/game/story/village.patter/game-scopes");
    expect(findGameScopes("/game/story/village.patter", own)).toEqual({ dir: "/game/story/village.patter/game-scopes" });
  });

  it("stops at the version-control root, so a folder above the repository is never picked up", () => {
    const fs = tree("/work/game-scopes", "/work/game/.git", "/work/game/story/village.patter");
    expect(findGameScopes("/work/game/story/village.patter", fs)).toEqual({});
  });

  it("stops at the top of the file system when there is no repository, and finding none is not an error", () => {
    expect(findGameScopes("/a/b/c", tree("/a/b/c"))).toEqual({});
    expect(findGameScopes("/a/b/c", tree("/game-scopes", "/a/b/c"))).toEqual({ dir: "/game-scopes" });
  });

  it("takes an override relative to the project, which must exist", () => {
    const fs = tree("/game/shared/game-scopes", "/game/story/village.patter");
    expect(findGameScopes("/game/story/village.patter", fs, { override: "../../shared/game-scopes" })).toEqual({ dir: "/game/shared/game-scopes" });
    expect(findGameScopes("/game/story/village.patter", fs, { override: "../missing" }))
      .toEqual({ issue: "the project names a game scopes folder that doesn't exist: /game/story/missing" });
  });

  it("names the folder once, for every tool", () => {
    expect(GAME_SCOPES_DIR).toBe("game-scopes");
  });
});

describe("mergeScopes", () => {
  it("merges every file into one spec and records who declares each token", () => {
    const merged = mergeScopes(folder);
    expect(merged.issues).toEqual([]);
    expect(merged.spec.scopes.map((s) => s.token)).toEqual(["world", "system", "telemetry", "patter", "story"]);
    expect(merged.owners.get("story")).toEqual({ owner: "Storylet Engine", fileName: "storylets.scopes.json" });
  });

  it("reports a token two files declare, naming both, and keeps the one that sorts first whatever the read order", () => {
    const rival: NamedScopesFile = { fileName: "another.scopes.json", file: { version: 1, owner: "Another", scopes: [{ token: "patter" }] } };
    for (const files of [[...folder, rival], [rival, ...folder]]) {
      const merged = mergeScopes(files);
      expect(merged.issues).toEqual([{ severity: "error", file: "patter.scopes.json",
        message: "scope '@patter' is declared by both another.scopes.json (Another) and patter.scopes.json (Patter)" }]);
      expect(merged.owners.get("patter")!.owner).toBe("Another");
    }
  });

  it("gives one scope's declarations, or none for an unknown or opaque token", () => {
    const merged = mergeScopes(folder);
    expect(declarationsOf(merged, "world")).toEqual(game.scopes[0]!.declarations);
    expect(declarationsOf(merged, "telemetry")).toBeUndefined();
    expect(declarationsOf(merged, "nosuch")).toBeUndefined();
  });
});

describe("what an editor and a compiler read from the merged scopes", () => {
  const merged = mergeScopes(folder);

  it("the schema carries every declared scope but the caller's own, names lower-cased, ladders kept, opaque scopes left out", () => {
    const schema = scopesSchema(merged, { except: ["patter"] });
    expect([...schema.properties.keys()]).toEqual(["world", "system", "story"]);
    expect(schema.properties.get("story")!.get("act")).toEqual({ type: "quality", stages: ["one", "two", "three"] });
    expect(scopesSchema(mergeScopes([{ fileName: "p", file: { ...patter, scopes: [{ token: "patter", declarations: [{ name: "Visits", type: "number" }] }] } }]))
      .properties.get("patter")!.has("visits")).toBe(true);
  });

  it("the catalogue lists the others' properties in declaration order, with their notes and owners", () => {
    const cat = scopesCatalogue(merged, { except: ["story"] });
    expect(cat.filter((e) => e.scope === "patter")).toEqual([
      { scope: "patter", name: "visits", type: "number", purpose: "How often the guard has shouted", owner: "Patter" },
      { scope: "patter", name: "mood", type: "enum", enumValues: ["calm", "tense"], owner: "Patter" },
    ]);
    expect(cat.some((e) => e.scope === "story")).toBe(false);
  });

  it("says when a name is not declared, or is written where it may only be read, and nothing otherwise", () => {
    expect(referenceNote(merged, "patter", "vists")).toBe("@patter.vists is not declared by Patter (game-scopes/patter.scopes.json)");
    expect(referenceNote(merged, "patter", "VISITS")).toBeUndefined();
    expect(referenceNote(merged, "story", "rumours", { write: true })).toBe("@story.rumours is read-only: Storylet Engine (game-scopes/storylets.scopes.json) declares it so");
    expect(referenceNote(merged, "story", "rumours")).toBeUndefined();
    expect(referenceNote(merged, "system", "platform", { write: true })).toMatch(/is read-only/);   // the scope's own writable
    expect(referenceNote(merged, "telemetry", "anything", { write: true })).toBeUndefined();        // opaque
    expect(referenceNote(merged, "party", "coin")).toBeUndefined();                                // nobody declares @party
  });
});

describe("standInRegistry", () => {
  it("holds every scope but the caller's own, seeded from the declared defaults, for a preview", () => {
    const registry = standInRegistry(mergeScopes(folder), { except: ["story"] });
    expect(registry.has("story")).toBe(false);
    expect(registry.get("patter", "visits")).toBe(0);
    expect(registry.get("patter", "mood")).toBe("calm");
    expect(registry.get("world", "time_of_day")).toBe("day");
    expect(registry.has("telemetry")).toBe(true);
    expect(registry.listProperties().find((r) => r.scope === "patter")!.owner).toBe("Patter");
  });

  it("refuses the writes a game would: a read-only property, and a read-only scope's properties", () => {
    const registry = standInRegistry(mergeScopes(folder), { except: ["patter"] });
    expect(() => registry.set("story", "rumours", 3)).toThrow();
    expect(() => registry.set("system", "platform", "mac")).toThrow();
    registry.set("story", "act", "two");
    expect(registry.get("story", "act")).toBe("two");
  });
});
