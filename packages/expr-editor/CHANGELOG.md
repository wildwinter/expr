# Changelog

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
