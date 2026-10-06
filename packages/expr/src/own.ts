// ---------------------------------------------------------------------------
// Own-property reads, for every lookup by a name an author wrote.
//
// The language's names come from authors (`@world.constructor`, a function
// called `toString`), and a plain JavaScript object answers the names it
// inherits from Object.prototype. Looked up with `record[name]`, the keyword
// table turned `constructor` into a token that was not an identifier, a static
// scope bag read a built-in function as a property's value, and a dialect's
// function table offered `Object` as a function to call (October 2026 review).
// Every such lookup goes through `own`, which sees a record's own entries only.
// ---------------------------------------------------------------------------

/** `record[key]` when the record has it as its OWN property, else undefined. */
export function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
