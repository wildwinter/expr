// ---------------------------------------------------------------------------
// Parser - text -> ExprNode, parameterised by a Dialect.
//
// Tokeniser, operator precedence, and node construction are generic. The only
// dialect-supplied inputs are: the valid scope tokens, the default scope for
// bare `@name`, and which function names take flag-delta trailing args.
//
// Ported from @storylets/expressions (storylets/packages/expressions/src/parser.ts),
// generalised by injecting the above from the Dialect.
// ---------------------------------------------------------------------------

import type { BinaryOp, ExprNode } from "./ast.js";
import type { Dialect } from "./dialect.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
    public readonly source: string
  ) {
    super(`Parse error at position ${pos}: ${message}\n  ${source}\n  ${" ".repeat(pos)}^`);
    this.name = "ParseError";
  }
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type TokKind =
  | "NUM" | "STR" | "BOOL" | "VAR" | "IDENT"
  | "LPAREN" | "RPAREN" | "COMMA" | "DOT"
  | "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE"
  | "PLUS" | "MINUS" | "STAR" | "SLASH"
  | "AND" | "OR" | "NOT"
  | "EOF";

interface Token {
  kind: TokKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, TokKind> = {
  true: "BOOL", false: "BOOL",
  and: "AND", or: "OR", not: "NOT",
};

function tokenise(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // whitespace
    if (/\s/.test(src[i]!)) { i++; continue; }

    const pos = i;

    // variable reference  @name
    if (src[i] === "@") {
      const m = src.slice(i).match(/^@([a-z_][a-z0-9_]*)/);
      if (!m) throw new ParseError(`unexpected character '@'`, pos, src);
      tokens.push({ kind: "VAR", value: m[1]!, pos });
      i += m[0].length;
      continue;
    }

    // string literal - single or double quoted, basic escape sequences
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i]!;
      let s = "";
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          i++;
          const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
          s += esc[src[i]!] ?? src[i]!;
        } else {
          s += src[i]!;
        }
        i++;
      }
      if (i >= src.length) throw new ParseError("unterminated string literal", pos, src);
      i++; // closing quote
      tokens.push({ kind: "STR", value: s, pos });
      continue;
    }

    // number literal
    if (/[0-9]/.test(src[i]!)) {
      const m = src.slice(i).match(/^[0-9]+(\.[0-9]+)?/);
      tokens.push({ kind: "NUM", value: m![0], pos });
      i += m![0].length;
      continue;
    }

    // two-character operators
    const two = src.slice(i, i + 2);
    if (two === "==") { tokens.push({ kind: "EQ",  value: "==", pos }); i += 2; continue; }
    if (two === "!=") { tokens.push({ kind: "NEQ", value: "!=", pos }); i += 2; continue; }
    if (two === "<>") { tokens.push({ kind: "NEQ", value: "<>", pos }); i += 2; continue; }
    // single = is an alias for == (common authoring mistake)
    if (src[i] === "=" && src[i + 1] !== "=") { tokens.push({ kind: "EQ", value: "=", pos }); i++; continue; }
    if (two === ">=") { tokens.push({ kind: "GTE", value: ">=", pos }); i += 2; continue; }
    if (two === "<=") { tokens.push({ kind: "LTE", value: "<=", pos }); i += 2; continue; }
    if (two === "&&") { tokens.push({ kind: "AND", value: "&&", pos }); i += 2; continue; }
    if (two === "||") { tokens.push({ kind: "OR",  value: "||", pos }); i += 2; continue; }

    // single-character operators and punctuation
    const ch = src[i]!;
    if (ch === ">") { tokens.push({ kind: "GT",     value: ">",  pos }); i++; continue; }
    if (ch === "<") { tokens.push({ kind: "LT",     value: "<",  pos }); i++; continue; }
    if (ch === "+") { tokens.push({ kind: "PLUS",   value: "+",  pos }); i++; continue; }
    if (ch === "-") { tokens.push({ kind: "MINUS",  value: "-",  pos }); i++; continue; }
    if (ch === "*") { tokens.push({ kind: "STAR",   value: "*",  pos }); i++; continue; }
    if (ch === "/") { tokens.push({ kind: "SLASH",  value: "/",  pos }); i++; continue; }
    if (ch === "(") { tokens.push({ kind: "LPAREN", value: "(",  pos }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "RPAREN", value: ")",  pos }); i++; continue; }
    if (ch === ",") { tokens.push({ kind: "COMMA",  value: ",",  pos }); i++; continue; }
    if (ch === ".") { tokens.push({ kind: "DOT",    value: ".",  pos }); i++; continue; }
    if (ch === "!") { tokens.push({ kind: "NOT",    value: "!",  pos }); i++; continue; }

    // identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      const m = src.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      const word = m![0];
      const kw = KEYWORDS[word];
      tokens.push({ kind: kw ?? "IDENT", value: word, pos });
      i += word.length;
      continue;
    }

    throw new ParseError(`unexpected character '${ch}'`, pos, src);
  }

  tokens.push({ kind: "EOF", value: "", pos: i });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser - recursive descent
//
// Precedence (low -> high):
//   or / ||
//   and / &&
//   not / !  (prefix)
//   == != > >= < <=
//   + -
//   * /
//   unary -
//   primary
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  private readonly scopes: Set<string>;
  private readonly defaultScope: string;
  private readonly flagDeltaFns: Set<string>;

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
    dialect: Dialect
  ) {
    this.scopes = new Set(dialect.scopes.map((s) => s.token));
    this.defaultScope = dialect.defaultScope;
    this.flagDeltaFns = new Set(
      Object.entries(dialect.functions)
        .filter(([, def]) => def.flagDeltaArgs)
        .map(([name]) => name)
    );
  }

  private peek(): Token { return this.tokens[this.pos]!; }
  private advance(): Token { return this.tokens[this.pos++]!; }
  private check(kind: TokKind): boolean { return this.peek().kind === kind; }

  private expect(kind: TokKind): Token {
    if (!this.check(kind)) {
      const tok = this.peek();
      throw new ParseError(`expected ${kind}, got '${tok.value}'`, tok.pos, this.src);
    }
    return this.advance();
  }

  parse(): ExprNode {
    const node = this.parseOr();
    if (!this.check("EOF")) {
      const tok = this.peek();
      throw new ParseError(`unexpected token '${tok.value}'`, tok.pos, this.src);
    }
    return node;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.check("OR")) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.check("AND")) {
      this.advance();
      const right = this.parseNot();
      left = { kind: "binary", op: "and", left, right };
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.check("NOT")) {
      this.advance();
      const operand = this.parseNot();
      return { kind: "unary", op: "not", operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    const left = this.parseAdditive();
    const opMap: Partial<Record<TokKind, BinaryOp>> = {
      EQ: "==", NEQ: "!=", GT: ">", GTE: ">=", LT: "<", LTE: "<=",
    };
    const op = opMap[this.peek().kind];
    if (op !== undefined) {
      this.advance();
      const right = this.parseAdditive();
      return { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (this.check("PLUS") || this.check("MINUS")) {
      const op: BinaryOp = this.advance().kind === "PLUS" ? "+" : "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnaryMinus();
    while (this.check("STAR") || this.check("SLASH")) {
      const op: BinaryOp = this.advance().kind === "STAR" ? "*" : "/";
      const right = this.parseUnaryMinus();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnaryMinus(): ExprNode {
    if (this.check("MINUS")) {
      this.advance();
      const operand = this.parseUnaryMinus();
      // Fold constant: -5 -> NumberNode(-5) rather than UnaryNode(neg, 5)
      if (operand.kind === "number") return { kind: "number", value: -operand.value };
      return { kind: "unary", op: "neg", operand };
    }
    return this.parsePrimary();
  }

  // Scope-qualified property ref: <scope>.<name> (after a VAR or IDENT token).
  private maybeScopedVar(name: string): ExprNode | null {
    if (this.scopes.has(name) && this.check("DOT")) {
      this.advance(); // consume DOT
      const propTok = this.peek();
      if (propTok.kind !== "IDENT") {
        throw new ParseError(
          `expected a property name after '${name}.', got '${propTok.value}'`,
          propTok.pos, this.src
        );
      }
      this.advance();
      return { kind: "scopedvar", scope: name, name: propTok.value.toLowerCase() };
    }
    return null;
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();

    if (tok.kind === "BOOL") {
      this.advance();
      return { kind: "bool", value: tok.value === "true" };
    }

    if (tok.kind === "NUM") {
      this.advance();
      return { kind: "number", value: Number(tok.value) };
    }

    if (tok.kind === "STR") {
      this.advance();
      return { kind: "string", value: tok.value };
    }

    if (tok.kind === "VAR") {
      const name = tok.value;
      this.advance();
      // @scope.propName - e.g. @zone.weather, @deck.quest_done
      const scoped = this.maybeScopedVar(name);
      if (scoped) return scoped;
      // Bare `@name` is shorthand for `@<defaultScope>.name`. We canonicalise to
      // scoped form at parse time so the AST has a single property-reference
      // shape to handle downstream.
      return { kind: "scopedvar", scope: this.defaultScope, name: name.toLowerCase() };
    }

    if (tok.kind === "IDENT") {
      const name = tok.value;
      this.advance();

      // Scope-qualified property reference: world.x / scene.x / ...
      const scoped = this.maybeScopedVar(name);
      if (scoped) return scoped;

      if (this.check("LPAREN")) {
        this.advance();
        const args: ExprNode[] = [];
        if (!this.check("RPAREN")) {
          args.push(this.parseOr());
          while (this.check("COMMA")) {
            this.advance();
            // Flag-delta functions: after the variable arg, remaining args are
            // flag deltas (+flagName / -flagName).
            const wantsFlagDelta = this.flagDeltaFns.has(name) && args.length >= 1;
            if (wantsFlagDelta) {
              const sign = this.check("PLUS") ? "+" : this.check("MINUS") ? "-" : null;
              if (sign === null) {
                const t = this.peek();
                throw new ParseError(
                  `${name}: expected +flagName or -flagName, got '${t.value}'`,
                  t.pos, this.src
                );
              }
              this.advance();
              const flagTok = this.peek();
              if (flagTok.kind !== "IDENT") {
                throw new ParseError(
                  `${name}: expected a flag name after '${sign}', got '${flagTok.value}'`,
                  flagTok.pos, this.src
                );
              }
              this.advance();
              args.push({ kind: "flagdelta", sign, name: flagTok.value });
            } else {
              args.push(this.parseOr());
            }
          }
        }
        this.expect("RPAREN");
        return { kind: "call", name, args };
      }
      // Bare identifier with no ( - treat as an unquoted string literal.
      // Allows @season == winter as sugar for @season == "winter".
      return { kind: "string", value: name };
    }

    if (tok.kind === "LPAREN") {
      this.advance();
      const inner = this.parseOr();
      this.expect("RPAREN");
      return inner;
    }

    if (tok.kind === "EOF") {
      throw new ParseError("expression is incomplete - expected a value", tok.pos, this.src);
    }
    throw new ParseError(`unexpected token '${tok.value}'`, tok.pos, this.src);
  }
}

// ---------------------------------------------------------------------------
// Public: parse
// ---------------------------------------------------------------------------

export function parse(source: string, dialect: Dialect): ExprNode {
  const tokens = tokenise(source);
  return new Parser(tokens, source, dialect).parse();
}
