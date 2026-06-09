// Lifted from storylets/packages/expressions/src/__tests__/validator.test.ts and
// adapted to the dialect API (parse(src, D) / validateExpr(node, schema, D)).
// Proves the ported, generalised validator reproduces storylets' validation.

import { describe, it, expect } from "vitest";
import { parse, validateExpr, type ExpressionSchema } from "../src/index.js";
import { storyletsDialect as D } from "./storylets-dialect.js";

const p = (s: string) => parse(s, D);
const v = (s: string, schema: ExpressionSchema) => validateExpr(p(s), schema, D);

function schema(record: Record<string, "boolean" | "number" | "string" | "enum" | "flags">): ExpressionSchema {
  const world = new Map(Object.entries(record).map(([k, t]) => [k.toLowerCase(), { type: t }]));
  return { properties: new Map([["world", world]]) };
}

function flagSchema(flagNames: string[]): ExpressionSchema {
  return {
    properties: new Map([
      ["world", new Map([
        ["var_q", { type: "flags" as const, enumValues: flagNames }],
        ["var_n", { type: "number" as const }],
      ])],
    ]),
  };
}

describe("check_flags() - validateExpr", () => {
  it("passes with a single positive flag", () => {
    expect(v("check_flags(@var_q, +tree_task)", flagSchema(["tree_task", "met_blacksmith"]))).toHaveLength(0);
  });
  it("passes with mixed positive and negative flags", () => {
    expect(v("check_flags(@var_q, +tree_task, -met_blacksmith)", flagSchema(["tree_task", "met_blacksmith"]))).toHaveLength(0);
  });
  it("reports error for zero arguments", () => {
    expect(v("check_flags()", flagSchema(["x"])).some(i => i.message.includes("check_flags()"))).toBe(true);
  });
  it("reports error when first arg is not a flags property", () => {
    expect(v("check_flags(@var_n, +tree_task)", flagSchema(["tree_task"])).some(i => i.message.includes("not a flags property"))).toBe(true);
  });
  it("reports error for an unknown flag name (positive and negative)", () => {
    expect(v("check_flags(@var_q, +unknown_flag)", flagSchema(["tree_task"])).some(i => i.message.includes("unknown_flag"))).toBe(true);
    expect(v("check_flags(@var_q, -ghost_flag)", flagSchema(["tree_task"])).some(i => i.message.includes("ghost_flag"))).toBe(true);
  });
});

describe("set_flags() - validateExpr", () => {
  it("passes with valid flags", () => {
    expect(v("set_flags(@var_q, +tree_task, -met_blacksmith)", flagSchema(["tree_task", "met_blacksmith"]))).toHaveLength(0);
  });
  it("reports error for zero arguments", () => {
    expect(v("set_flags()", flagSchema(["x"])).some(i => i.message.includes("set_flags()"))).toBe(true);
  });
  it("reports error when first arg is not a flags property", () => {
    expect(v("set_flags(@var_n, +tree_task)", flagSchema(["tree_task"])).some(i => i.message.includes("not a flags property"))).toBe(true);
  });
  it("reports unknown flag in negative position too", () => {
    expect(v("set_flags(@var_q, -ghost_flag)", flagSchema(["tree_task"])).some(i => i.message.includes("ghost_flag"))).toBe(true);
  });
  it("uses the right function-name prefix", () => {
    expect(v("set_flags(@var_n, +x)", flagSchema(["x"])).some(i => i.message.startsWith("set_flags()"))).toBe(true);
  });
});

describe("validateExpr - general", () => {
  it("passes with no issues for a valid expression", () => {
    expect(v("@var_rep02x > 0", schema({ var_rep02x: "number" }))).toHaveLength(0);
  });
  it("reports unresolved property reference", () => {
    expect(v("@var_unknown > 0", schema({ var_rep02x: "number" })).some(i => i.message.includes("@var_unknown"))).toBe(true);
  });
  it("reports unknown function", () => {
    expect(v('foobar("x")', schema({})).some(i => i.message.includes("unknown function"))).toBe(true);
  });
  it("reports wrong arity for site_has_tag and random", () => {
    expect(v('site_has_tag("a", "b")', schema({})).some(i => i.message.includes("site_has_tag()"))).toBe(true);
    expect(v('random("seed")', schema({})).some(i => i.message.includes("random()"))).toBe(true);
    expect(v('random(1, 6, 10)', schema({})).some(i => i.message.includes("random()"))).toBe(true);
  });
  it("validates nested variable refs", () => {
    const issues = v("@var_a > 0 and @var_missing == true", schema({ var_a: "boolean" }));
    expect(issues.some(i => i.message.includes("@var_missing"))).toBe(true);
    expect(issues.some(i => i.message.includes("@var_a"))).toBe(false);
  });
});

describe("scopedvar - validateExpr", () => {
  function scopedSchema(
    worldEntries: [string, "boolean" | "number" | "enum" | "flags"][] = [],
    zoneEntries: [string, "boolean" | "number" | "enum" | "flags"][] = [],
  ): ExpressionSchema {
    return {
      properties: new Map([
        ["world", new Map(worldEntries.map(([k, t]) => [k, { type: t }]))],
        ["zone", new Map(zoneEntries.map(([k, t]) => [k, { type: t }]))],
      ]),
    };
  }

  it("passes when a property is declared on the scope (@ and bare)", () => {
    expect(v("@world.season", scopedSchema([["season", "enum"]]))).toHaveLength(0);
    expect(v("world.season", scopedSchema([["season", "enum"]]))).toHaveLength(0);
  });
  it("reports unresolved world property by bare name", () => {
    const issues = v("@world.missing_prop", scopedSchema([["season", "enum"]]));
    expect(issues.some(i => i.message.includes("missing_prop"))).toBe(true);
    expect(issues.some(i => i.reference === "missing_prop")).toBe(true);
  });
  it("reports unresolved @zone.x not declared on zone", () => {
    expect(v("@zone.weather", scopedSchema([], [])).some(i => i.message.includes("zone.weather"))).toBe(true);
  });
  it("is permissive when the scope is absent from the schema", () => {
    expect(v("@deck.any_prop", { properties: new Map() })).toHaveLength(0);
    expect(v("@site.searched", scopedSchema([["season", "enum"]]))).toHaveLength(0);
  });
});
