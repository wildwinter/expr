// Where a problem is: dotted names, `[i]` for a list position, and `["..."]`
// for a key that is not an identifier, so a path reads the way the JSON does.

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `base` and then the key `key`. */
export const atKey = (base: string, key: string): string =>
  (IDENTIFIER.test(key) ? (base === "" ? key : `${base}.${key}`) : `${base}[${JSON.stringify(key)}]`);

/** `base` and then list position `i`. */
export const atIndex = (base: string, i: number): string => `${base}[${i}]`;

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An author-written name read as an own property, never through the prototype. */
export const own = (record: object, name: string): boolean => Object.prototype.hasOwnProperty.call(record, name);
