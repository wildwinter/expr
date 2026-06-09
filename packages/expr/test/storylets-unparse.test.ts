// Lifted from storylets/packages/expressions/src/__tests__/unparse.test.ts and
// adapted to the dialect API (parse(src, D) / unparse(node, { defaultScope: "world" })).

import { describe, it, expect } from "vitest";
import { parse, unparse } from "../src/index.js";
import { storyletsDialect as D } from "./storylets-dialect.js";

const p = (s: string) => parse(s, D);
const u = (s: string) => unparse(p(s), { defaultScope: "world" });
const roundTrip = (s: string) => unparse(parse(u(s), D), { defaultScope: "world" });

describe("unquoted enum values - unparse", () => {
  it("emits bare identifier for identifier-safe strings", () => { expect(u("@v == autumn")).toBe("@v == autumn"); });
  it("keeps quotes for strings with spaces", () => { expect(u('"hello world"')).toBe('"hello world"'); });
  it("keeps quotes for empty string", () => { expect(u('""')).toBe('""'); });
});

describe("check_flags() / set_flags() - unparse", () => {
  it("unparses back to canonical form", () => {
    expect(u("check_flags(@var_q, +tree_task, -herbs_found)")).toBe("check_flags(@var_q, +tree_task, -herbs_found)");
    expect(u("set_flags(@var_q, +tree_task, -met_blacksmith)")).toBe("set_flags(@var_q, +tree_task, -met_blacksmith)");
  });
  it("round-trips through parse -> unparse -> parse", () => {
    expect(roundTrip("check_flags(@var_q, +a, -b)")).toBe("check_flags(@var_q, +a, -b)");
    expect(roundTrip("set_flags(@var_q, +a, -b)")).toBe("set_flags(@var_q, +a, -b)");
  });
});

describe("scopedvar - unparse", () => {
  it("world canonicalises to bare @name; other scopes emit qualified", () => {
    expect(u("@world.season")).toBe("@season");
    expect(u("@deck.troubled_seen")).toBe("@deck.troubled_seen");
    expect(u("@zone.weather")).toBe("@zone.weather");
    expect(u("@site.searched")).toBe("@site.searched");
    expect(u("world.season")).toBe("@season");
  });
  it("round-trips a mixed-scope expression", () => {
    const src = "@season == autumn and @zone.weather != storm";
    expect(roundTrip(src)).toBe(src);
  });
});
