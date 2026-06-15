# Port spec — storylets condition editor → @wildwinter/expr-editor

Ported from the storylets authoring tool's React editor (same `ExprNode` language).
Vanilla TS + DOM. The host string contract is **name-form** (`@gold > 0 and @met`,
`""` = always). The editor owns `ExprNode` internally.

`@wildwinter/expr` API used: `parse(src, dialect): ExprNode` (throws `ParseError`),
`unparse(node, {defaultScope}): string`, `parseAndValidate(src, schema, dialect):
{ ok, issues, summary, ast }`, `validateExpr(node, schema, dialect): issues[]`.
`ExpressionSchema = { properties: Map<scope, Map<name(lc), {type, enumValues?}>> }`.
`AstPath = (string|number)[]` with field-name segments (`"left"`, `"right"`,
`"operand"`, `"args"` + numeric index); top-level = `[]`.

## 1. AST path mutation (`ast.ts`) — pure, ports verbatim
- `getNodeAt(ast, path)`, `setNodeAt(ast, path, node)` (structural sharing).
- `deleteAt(ast, path) -> ExprNode | null`: root delete -> null. Collapse rules:
  binary parent -> surviving sibling replaces parent (`A and B` del B -> `A`); unary
  parent -> operand replaces; call parent -> splice the arg out.
- `insertSiblingClauseAt(ast, path, op, side, clause)`: wrap target in `binary(op,…)`,
  side chooses which operand the clause is.
- `wrapInNotAt` / `isWrappedInNot` / `toggleNotAt`.
- `findEnumPeer(ast, path)`: if parent is `binary ==|!=` and the other operand is a
  `scopedvar`, return it (drives the enum-value dropdown).
- placeholder builders: `placeholderForOp(op)` (`bool(true)` for and, `bool(false)`
  for or — no-op sentinels), `isPlaceholderForOp`, `makeComparisonClause(name?)`.

## 2. Tree model (`tree.ts`) — derived per render, never stored
`TreeRow = container{op,negated,children,path,chainPath} | comparison{left,op,right,
negated,path,contentPath} | wrapped{node,negated,path,contentPath}`.
- `path` = outermost node (the `not` wrapper when negated). `chainPath` = binary chain
  root. `contentPath` = editable inner subtree (`path` or `path+["operand"]`).
- `astToTree(node, path=[])`: peel order — negated and/or container; and/or container
  (flatten same-op left-folded chains to N children); negated comparison; comparison
  (`== != > >= < <=`); negated wrapped; wrapped (calls / arithmetic / bool var).
- container ops: `addChildToContainer`, `flipContainerOp` (re-polarise placeholders),
  `toggleContainerNot`, `buildSubGroupClause` (child op = opposite of parent),
  `moveChildInContainer`.

## 3. Operator metadata (`ops.ts`)
- `BINARY_LABEL` (`and→AND or→OR ==→is !=→≠ >=→≥ …`), `opSwapGroup` (COMPARISON_OPS,
  ARITHMETIC_OPS; and/or/not structural, not swappable), `BINARY_PREC` + `needsParens`,
  `formatNumber` (ints plain; floats via `toFixed(12)` to strip IEEE noise).

## 4. Pills (`ui`): var(property) bool number string tag func flag+ flag- operator
error "always". Themed to host CSS vars (host passes a class prefix / tokens).

## 5. Per-node popover micro-editors: scopedvar→PropertyPicker (+ "use literal"),
bool→true/false, number→NumberInput, string→free / enum-list (when enum peer) / tag,
operator→swap list (comparison/arithmetic only), flagdelta→sign+name (used names
filtered), call→delete (+ add-flagdelta for flag fns).

## 6. PropertyPicker (`schema.ts` builds catalogue): entries {scope,name,type,
enumValues?,purpose?,ref}; filter by acceptTypes/acceptScopes; search name+purpose;
group by scope; emit `@name` (default scope) or `@scope.name`.

## 7. Clause wizards — GENERIC core: "Property comparison" (pick prop → op → rhs),
"Property is true" (bool var), AND/OR group. DIALECT-DRIVEN functions (config):
check_flags, site_has_tag, count_played_tag, turns_since_tag, random — each a
`FunctionTemplateSpec` {name,label,hint,booleanReturning,arity,steps}.

## 8. Chrome: flat / tree / raw-text `</>` toggle; raw textarea (parse-on-change, host
re-validates); validation = parse error (forces raw) | semantic issues (red, indexed
by path → ring offending pill) | warnings (yellow). Editing-suppression: freeze inline
errors while a micro-editor popover is open. Tree: container header AND/OR flip +
NOT toggle; per-row NOT / ↑↓ / ✕; +Add condition / +Add AND·OR group; placeholder
rows ("+ click to add"); empty -> nullRender ("always") + "add first condition".

## 9. Public API (`mount.ts`)
`mountExpressionEditor(host, { value, schema, dialect, catalogue, functions?, mode?,
isCondition?, requireNonEmpty?, valueEnumValues?, nullRender?, onChange }) ->
{ setValue(v), destroy() }`. Emits name-form `onChange` on every mutation (`""` cleared).
