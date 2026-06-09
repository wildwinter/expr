// Lifted from storylets/packages/expressions/src/__tests__/parser.test.ts and
// adapted to the dialect API (parse(src, D)). Proves the ported parser
// reproduces storylets' parsing behaviour.

import { describe, it, expect } from "vitest";
import { parse, ParseError } from "../src/index.js";
import { storyletsDialect as D } from "./storylets-dialect.js";

const p = (s: string) => parse(s, D);

describe("check_flags() - parse", () => {
  it("parses a single positive flag", () => {
    const node = p("check_flags(@var_q, +tree_task)");
    expect(node.kind).toBe("call");
    if (node.kind !== "call") return;
    expect(node.name).toBe("check_flags");
    expect(node.args).toHaveLength(2);
    expect(node.args[1]).toEqual({ kind: "flagdelta", sign: "+", name: "tree_task" });
  });

  it("parses a single negative flag", () => {
    const node = p("check_flags(@var_q, -herbs_found)");
    if (node.kind !== "call") return;
    expect(node.args[1]).toEqual({ kind: "flagdelta", sign: "-", name: "herbs_found" });
  });

  it("parses multiple mixed flags", () => {
    const node = p("check_flags(@var_q, +a, +b, -c)");
    if (node.kind !== "call") return;
    expect(node.args).toHaveLength(4);
    expect(node.args[1]).toEqual({ kind: "flagdelta", sign: "+", name: "a" });
    expect(node.args[2]).toEqual({ kind: "flagdelta", sign: "+", name: "b" });
    expect(node.args[3]).toEqual({ kind: "flagdelta", sign: "-", name: "c" });
  });

  it("throws a parse error when a flag arg has no sign", () => {
    expect(() => p("check_flags(@var_q, tree_task)")).toThrow(ParseError);
  });

  it("throws a parse error when a flag arg sign has no name", () => {
    expect(() => p("check_flags(@var_q, +)")).toThrow(ParseError);
  });
});

describe("set_flags() - parse", () => {
  it("parses a single positive flag", () => {
    const node = p("set_flags(@var_q, +tree_task)");
    if (node.kind !== "call") return;
    expect(node.name).toBe("set_flags");
    expect(node.args).toHaveLength(2);
    expect(node.args[1]).toEqual({ kind: "flagdelta", sign: "+", name: "tree_task" });
  });

  it("parses mixed positive and negative flags", () => {
    const node = p("set_flags(@var_q, +a, -b, +c)");
    if (node.kind !== "call") return;
    expect(node.args).toHaveLength(4);
  });

  it("throws when a flag arg has no sign / no name", () => {
    expect(() => p("set_flags(@var_q, tree_task)")).toThrow(ParseError);
    expect(() => p("set_flags(@var_q, +)")).toThrow(ParseError);
  });
});

describe("ParseError", () => {
  it("throws on unterminated string", () => { expect(() => p('"unterminated')).toThrow(ParseError); });
  it("throws on unexpected character", () => { expect(() => p("5 & 3")).toThrow(ParseError); });
  it("throws on trailing junk", () => { expect(() => p("true false")).toThrow(ParseError); });
  it("throws on missing closing paren", () => { expect(() => p("(5 + 3")).toThrow(ParseError); });
  it("throws on empty input", () => { expect(() => p("")).toThrow(ParseError); });
});

describe("scopedvar - parse", () => {
  it("parses @world.propname", () => {
    expect(p("@world.season")).toEqual({ kind: "scopedvar", scope: "world", name: "season" });
  });
  it("parses @deck / @zone / @site / @player", () => {
    expect(p("@deck.troubled_seen")).toEqual({ kind: "scopedvar", scope: "deck", name: "troubled_seen" });
    expect(p("@zone.weather")).toEqual({ kind: "scopedvar", scope: "zone", name: "weather" });
    expect(p("@site.searched")).toEqual({ kind: "scopedvar", scope: "site", name: "searched" });
    expect(p("@player.visits")).toEqual({ kind: "scopedvar", scope: "player", name: "visits" });
  });
  it("still parses bare scope.propname (backwards compat)", () => {
    expect(p("world.season")).toEqual({ kind: "scopedvar", scope: "world", name: "season" });
    expect(p("zone.weather")).toEqual({ kind: "scopedvar", scope: "zone", name: "weather" });
  });
  it("scoped refs can be compared", () => {
    expect(p('@world.season == "autumn"').kind).toBe("binary");
  });
  it("throws when @scope / bare scope is followed by dot but no identifier", () => {
    expect(() => p("@world.")).toThrow(ParseError);
    expect(() => p("@zone.")).toThrow(ParseError);
    expect(() => p("world.")).toThrow(ParseError);
  });
});
