# @wildwinter/expr-specificity

Matched-constraint specificity for [`@wildwinter/expr`](https://www.npmjs.com/package/@wildwinter/expr)
conditions: score **how many atomic constraints in a condition are actively
holding it true** against the current state.

This is an evaluation-aware score, not a static clause count. An `or`'s score
depends on which branch is currently matching; an `and` sums the constraints
that must all hold. It is the primitive behind Storylet Studio's storylet draw
priority and Patter's dialogue best-match, which had independently grown the
same algorithm.

The package is tiny and deliberately ignorant of evaluation: you pass an
`ExprNode` and an `evalTruthy` closure that says whether a subtree currently
holds. Your closure owns the eval context, the dialect, and your truthiness
rule, so this package never needs to know them.

## Install

```
npm install @wildwinter/expr-specificity
```

`@wildwinter/expr` is a peer dependency (you already have it - the AST comes
from there).

## Usage

```ts
import { evaluate, deserialiseAst } from "@wildwinter/expr";
import { matchedSpecificity } from "@wildwinter/expr-specificity";

const node = deserialiseAst(condition.ast);

// Host-bound truthiness: evaluate a subtree and coerce to a boolean however
// your host does (Storylets: non-zero number or true; Patter: its `truthy`).
const evalTruthy = (n) => conditionPasses(evaluate(n, ctx, dialect));

const score = matchedSpecificity(node, evalTruthy);
// `@x == 5 and @y > 3` with both holding -> 2
// `@a == 1 or @b == 1`  with either holding -> 1
```

## The walk

The score is a recursive walk carrying a polarity flag `want` ("the truth value
this subtree must have for the whole condition to hold"), starting `true` at the
root. De Morgan is applied as it descends:

| Node | Rule |
|---|---|
| atom (comparison, scoped var, literal, non-counting call) | `1` if its truth matches `want`, else `0` |
| `and` | under `want`: both must hold -> `left + right`, else `0`; under `!want`: behaves as `or` |
| `or` | under `want`: strongest branch -> `max(left, right)`; under `!want`: behaves as `and` |
| `not` | recurse into the operand with `want` flipped |
| counting call (default: `check_flags`) | its operand count when it must hold and does, else the negated rules |

`check_flags(v, f1..fN)` counts as N constraints (an N-ary AND over the flag
operands, `args.length - 1`, min 1). Add or replace counting calls via the
`countingCalls` option.

## API

- `matchedSpecificity(node, evalTruthy, opts?) => number`
- `opts.want` - root polarity (default `true`; production only scores eligible
  conditions).
- `opts.countingCalls` - calls scored by operand count (default
  `[CHECK_FLAGS_COUNTING_CALL]`).
- `CHECK_FLAGS_COUNTING_CALL` - the built-in `check_flags` rule.
- Types: `EvalTruthy`, `CountingCall`, `MatchedSpecificityOptions`.

## License

MIT
