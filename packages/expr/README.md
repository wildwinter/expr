# @wildwinter/expr

A small, **agnostic expression engine** - parse, unparse, evaluate, and serialise a
condition/effect expression language. The grammar, operators, and evaluator are fixed and
generic; the **scope tokens and built-in functions are injected via a `Dialect`**, so the same
core powers different host projects.

It was extracted from [Storylet Studio](https://github.com/storylet-studio)'s expression engine
and generalised so that both Storylet Studio and [Patter](https://patterkit.com) can share it.
Zero runtime dependencies; ESM + CJS + types.

```ts
import { parse, evaluate, unparse, compile, type Dialect } from "@wildwinter/expr";

const dialect: Dialect = {
  defaultScope: "shared",                 // bare @name -> @shared.name
  scopes: [{ token: "shared" }, { token: "scene" }, { token: "flow" }],
  functions: {
    max: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval: (args, h) => Math.max(h.evaluate(args[0]) as number, h.evaluate(args[1]) as number),
    },
  },
};

const node = parse("@hp < 10 and @scene.alarm", dialect);
evaluate(node, { scopes: { shared: { hp: 5 }, scene: { alarm: true } } }, dialect); // true
unparse(node, { defaultScope: "shared" });            // "@hp < 10 and @scene.alarm"
compile("@hp > 0", dialect);                          // { src, ast: ["bin", ">", ...] }  (bundle form)
```

## The language

- **Literals:** `true` / `false`, numbers (`42`, `3.14`), strings (`'x'` or `"x"`). A bare
  identifier with no `(` is sugar for a string (`@season == winter`).
- **Property refs:** `@name` (the dialect's default scope) or `@scope.name`. Names are lowercased.
- **Operators:** `and` `or` `not` (short-circuit; aliases `&&` `||` `!`), comparisons
  `== != > >= < <=` (`=` is an alias for `==`), arithmetic `+ - * /` (`+` also concatenates
  strings).
- **Functions:** dialect-supplied. A function may declare `flagDeltaArgs` so its trailing args
  parse as `+flag` / `-flag` (reaching `eval` as `flagdelta` nodes).

## API

- `parse(src, dialect): ExprNode` - text to AST (throws `ParseError`).
- `unparse(node, { defaultScope? }): string` - AST to canonical text (round-trip stable).
- `evaluate(node, ctx, dialect): ScalarValue` - walk the AST against `ctx.scopes` + `ctx.host`.
- `serialiseAst(node) / deserialiseAst(node)` - to/from the compact tagged-tuple bundle form.
- `compile(src, dialect): { src, ast }` - parse + serialise (the publish/compile step).

### Dialect

```ts
interface ScopeDef    { token: string; missing?: "false" | "throw" }   // missing-prop policy; default "false"
interface FunctionDef {
  minArgs: number; maxArgs?: number;
  returnType: "boolean" | "number" | "string" | "flags" | "unknown";
  flagDeltaArgs?: boolean;
  eval(rawArgs: ExprNode[], h: { evaluate; ctx }): ScalarValue;         // raw args; call h.evaluate(arg) as needed
}
interface Dialect     { scopes: ScopeDef[]; defaultScope: string; functions: Record<string, FunctionDef> }
```

A scope absent from the context resolves to `false`. A property missing from a *present* scope
follows that scope's `missing` policy.

## License

MIT (c) Ian Thomas.
