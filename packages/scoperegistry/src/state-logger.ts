// ---------------------------------------------------------------------------
// The state logger: what changed in the state kernel, as it changes.
//
// Both product families shipped one of these, in four runtimes each, and they
// were not the same shape. The Storylet Engine's was PUSH-based on the
// PropertyBag audit hook - a write logs the moment it lands, with the previous
// value straight off the event. Patterplay's diffed whole saveGame() snapshots,
// so it could only ever say what changed BETWEEN captures, and only for state a
// save persists. This is the first one, because it is the better one: a diff
// cannot tell a write from a write-and-write-back, cannot name the reason a
// host attached to a write, and cannot see a value that changed and changed
// back.
//
// A diff is still needed, and is kept, for everything that is NOT in a bag: a
// product's own non-property state (turns, cooldowns, visit counts) arrives
// through the adapter's `extra()` and is diffed on capture. Bags replaced
// wholesale by a load fire no audit events either, so capture() re-reads and
// re-mounts.
//
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for a value that
// was not there.
// ---------------------------------------------------------------------------

import type { PropertyBag, ScalarValue } from "./index.js";

/** A flattened snapshot: path -> value. */
export type StateSnapshot = Record<string, ScalarValue>;

export interface StateChange {
  path: string;
  from: ScalarValue | undefined;
  to: ScalarValue | undefined;
}

/**
 * One bag on the logger's path space.
 *
 * `pathPrefix` is used VERBATIM, separator included, exactly as the bag's own
 * is - it is not a scope token with a dot implied. Omit it and the bag's own
 * `pathPrefix` is used, which is what a product wants whenever its log paths
 * and its property addresses agree.
 *
 * They do not always agree, which is why this can be overridden: Patterplay
 * addresses a scene property `@scene.mood` (relative to the flow's current
 * scene) but has to LOG it as `@scene:kitchen.mood`, because a log covering
 * several scenes needs to say which one.
 */
export interface BagMount {
  bag: PropertyBag;
  pathPrefix?: string;
}

/** What a product supplies: its kernel bags (re-read on every capture, so a
 *  product that replaces its bags on load re-mounts), and its non-property
 *  state as flattened paths. */
export interface StateLoggerAdapter {
  mounts(): BagMount[];
  extra?(): StateSnapshot;
}

export interface StateLoggerOptions {
  /** Where lines go; defaults to console.log. */
  sink?: (line: string) => void;
  /** Prefixed to every line, verbatim (e.g. `"[board] "`). */
  label?: string;
}

export interface StateLogger {
  /** The current flattened state. Logs nothing. */
  snapshot(): StateSnapshot;
  /** Everything since the last capture: the audited writes already logged as
   *  they landed, plus anything that changed WITHOUT an audit event, diffed,
   *  logged and re-baselined. */
  capture(): StateChange[];
  /** Unhook the bag auditors. The logger is inert afterwards. */
  dispose(): void;
}

/** The sorted set of paths that differ between two snapshots. */
export function diffState(prev: StateSnapshot, next: StateSnapshot): StateChange[] {
  const changes: StateChange[] = [];
  const paths = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const path of [...paths].sort()) {
    const from = prev[path], to = next[path];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ path, from, to });
  }
  return changes;
}

const show = (v: ScalarValue | undefined): string => (v === undefined ? "<unset>" : JSON.stringify(v));

const prefixOf = (m: BagMount): string => m.pathPrefix ?? m.bag.pathPrefix;

export function createStateLogger(adapter: StateLoggerAdapter, opts: StateLoggerOptions = {}): StateLogger {
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const label = opts.label ?? "";
  const emit = (c: StateChange): void => { sink(`${label}${c.path}: ${show(c.from)} -> ${show(c.to)}`); };

  const full = (): StateSnapshot => {
    const out: StateSnapshot = {};
    for (const m of adapter.mounts()) {
      const prefix = prefixOf(m);
      for (const [name, value] of Object.entries(m.bag.values)) out[prefix + name] = value;
    }
    Object.assign(out, adapter.extra?.() ?? {});
    return structuredClone(out);
  };

  let baseline = full();
  let pushed: StateChange[] = [];
  let mounted: { bag: PropertyBag; off: () => void }[] = [];

  const hook = (prefix: string, bag: PropertyBag): (() => void) =>
    bag.onAudit((change) => {
      // The write logs as it lands, `from` straight off the event; the baseline
      // moves with it so capture() never re-reports what was already said.
      const c: StateChange = structuredClone({ path: prefix + change.name, from: change.prev, to: change.next });
      emit(c);
      pushed.push(c);
      baseline[c.path] = structuredClone(change.next);
    });

  const mount = (): void => {
    const mounts = adapter.mounts();
    const same = mounted.length === mounts.length && mounts.every((m, i) => mounted[i]!.bag === m.bag);
    if (same) return;
    for (const m of mounted) m.off();
    mounted = mounts.map((m) => ({ bag: m.bag, off: hook(prefixOf(m), m.bag) }));
  };
  mount();

  return {
    snapshot: full,
    capture(): StateChange[] {
      // Whatever arrived WITHOUT an audit event: the adapter's non-property
      // paths, and bag values replaced wholesale by a load (which fires none).
      const next = full();
      const diffed = diffState(baseline, next);
      for (const c of diffed) emit(c);
      const changes = [...pushed, ...diffed];
      pushed = [];
      baseline = next;
      mount();   // a load replaces a product's bags; re-hook them
      return changes;
    },
    dispose(): void {
      for (const m of mounted) m.off();
      mounted = [];
      pushed = [];
    },
  };
}
