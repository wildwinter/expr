# Changelog

## [0.18.0] - 2026-10-28

### Added

- **The effect picker creates a property.** With the new `onCreateProperty(name, scope)` option,
  the effects editor's "+ set property" picker offers `+ New property "<name>"`, with the scope
  it goes in, for search text no property in that scope has and which is a legal property name
  (letters, digits, and `_`, not starting with a digit, not a keyword). Text that can't be a name
  says why when nothing matched it. The host creates the declaration, choosing its type or asking
  the author, and returns it as a catalogue entry (or a promise of one), or `null` to cancel; the
  property then goes straight on to its value, as a listed one does. `newPropertyScopes` limits
  the scopes a new property can go in (default: the dialect's default scope), and typing
  `scope.name` picks one. Without the callback nothing changes. The picker's search also takes a
  leading `@`.
- **`homeScope`.** Name the host's own scope (Patterpad's `patter`) and every property pill reads
  the way an author writes a reference: `@gold` in that scope, `@world.time` in full elsewhere,
  on an effect's target and in its value alike, so `@patter.gold = gold + 1` now reads
  `@gold = @gold + 1`. Display only: targets are still written `@patter.gold`. Accepted by the
  expression editor, the effects editor, and the previews; without it, nothing changes.
- `pillLabel`, `targetLabel`, `newPropertyName`, and `schemaWith` are exported for hosts that
  draw or check the same things.

### Fixed

- The effects preview's target pill found its declaration only when the target was written in
  the `@gold` shorthand, so a target written in full (`@patter.gold`, as the editor writes them)
  had no tip and no right-click menu.

## [0.17.0] - 2026-10-28

### Added

- **Change by.** When `valueWizard` gets a number target's ref (`expectedType: "number"` with
  `expectedRef`, which the effects editor's "+ set property" passes), the number step leads with
  a "Change by" row: `＋ add` or `－ take away`, a "by" field, and Apply, writing `<ref> + n` or
  `<ref> - n`, so adding 1 to a property no longer means building `<ref> + 1` by hand.
  "Set it to" below it still sets a plain number, and when it is given an expression instead it says so and points at
  Change by, rather than greying Apply with no reason.
- **`stringArgChoices`.** A host can list the values a function's first string argument takes,
  such as `count_played`'s card: `{ [functionName]: [{ value, label? }] }`, or
  `{ choices, placeholder? }` for the empty slot's own words ("pick a card…"). A listed argument
  opens a searchable picker over labels and values, writes the value, and its pill shows the
  label. A function not listed keeps the free-text field. Accepted by the expression editor, the
  effects editor and the previews.

Earlier versions are recorded in the repository's history.
