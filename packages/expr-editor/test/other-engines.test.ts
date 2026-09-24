// A property pill that names another engine's scope (`@patter.visits` in a Storylets card). The
// family's compilers accept every other engine's game-wide token unchecked, since that engine owns
// its names; the host's catalogue therefore never lists them, and until `otherEngineScopes` the
// pill called each one an unknown property, in red, for content the compiler had accepted.

import { describe, it, expect } from "vitest";
import { propertyPillNote, scopeOfRef, type CatalogueEntry } from "../src/schema.js";

const visits: CatalogueEntry = { scope: "story", name: "visits", type: "number", purpose: "How often" };

describe("propertyPillNote", () => {
  it("a property the catalogue knows carries its tip and no issue", () => {
    expect(propertyPillNote(visits, "story", "@story.visits", ["patter"])).toEqual({ title: expect.stringContaining("How often") });
  });

  it("another engine's property carries no issue, and a tip that says whose it is", () => {
    const note = propertyPillNote(undefined, "patter", "@patter.visits", ["patter"]);
    expect(note.issue).toBeUndefined();
    expect(note.title).toBe("@patter.visits belongs to another engine, which checks it");
  });

  it("an unknown name in any other scope is still an issue, with or without the option", () => {
    expect(propertyPillNote(undefined, "story", "@story.nope", ["patter"])).toEqual({ issue: "Unknown property @story.nope" });
    expect(propertyPillNote(undefined, "patter", "@patter.visits")).toEqual({ issue: "Unknown property @patter.visits" });
  });
});

describe("scopeOfRef", () => {
  it("reads the scope of a qualified reference, and none from a bare one", () => {
    expect(scopeOfRef("@patter.gold")).toBe("patter");
    expect(scopeOfRef("@gold")).toBeUndefined();
    expect(scopeOfRef("")).toBeUndefined();
  });
});
