// ---------------------------------------------------------------------------
// Tiny DOM helpers — element creation, child clearing, and a floating popover
// primitive (positioned under an anchor, closes on outside-click / Escape). No
// framework, no dependencies; everything the vanilla UI needs.
// ---------------------------------------------------------------------------

export type Attrs = Record<string, string | number | boolean | undefined>;

/** Create an element with a class, attrs, and children (strings become text). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, children?: Array<Node | string | null | undefined>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const c of children ?? []) {
    if (c == null) continue;
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/** A <button type=button> with a class, label, and click handler. `aria` sets an
 *  aria-label (for glyph/icon buttons whose text isn't a good accessible name). */
export function button(cls: string, label: string | Node, onClick: (e: MouseEvent) => void, title?: string, aria?: string): HTMLButtonElement {
  const b = el("button", cls, [label]);
  b.type = "button";
  if (title) b.title = title;
  if (aria) b.setAttribute("aria-label", aria);
  b.addEventListener("click", onClick);
  return b;
}

export const clear = (node: HTMLElement): void => node.replaceChildren();

export interface Popover {
  el: HTMLElement;
  close(): void;
}

export interface PopoverOptions {
  /**
   * Where to append the popover. Defaults to document.body. Pass a container
   * inside a focus-trapping dialog (Radix, etc.) so the popover counts as
   * "inside" that layer and interacting with it does not dismiss the dialog.
   * The container should establish a containing block (a full-screen modal
   * layer or the dialog content element both qualify); the popover is then
   * positioned relative to that container's box rather than the document.
   */
  container?: HTMLElement;
  /** Called after the popover closes, for any reason. */
  onClose?: () => void;
}

/**
 * Open a floating popover anchored under `anchor`. `render(close)` builds the
 * content (call `close` to dismiss). Closes on Escape and on a pointer-down
 * outside the popover or the anchor. Only one popover lives at a time per call;
 * the caller tracks the handle to close it programmatically.
 */
export function openPopover(anchor: HTMLElement, render: (close: () => void) => Node, opts: PopoverOptions = {}): Popover {
  const container = opts.container ?? document.body;
  const pop = el("div", "exed-pop");
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    pop.remove();
    opts.onClose?.();
  };
  const onDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

  pop.append(render(close));
  container.append(pop);

  // Position under the anchor (viewport coords), flipped up if it would overflow.
  const a = anchor.getBoundingClientRect();
  const ph = pop.getBoundingClientRect();
  let top = a.bottom + 4;
  if (top + ph.height > window.innerHeight - 8 && a.top - ph.height - 4 > 8) top = a.top - ph.height - 4;
  let left = a.left;
  if (left + ph.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - ph.width);
  if (container === document.body) {
    // Document-coordinate placement (the unchanged default).
    pop.style.top = `${Math.round(top + window.scrollY)}px`;
    pop.style.left = `${Math.round(left + window.scrollX)}px`;
  } else {
    // Placement relative to the container's own box - it is the containing block
    // for the absolutely-positioned popover.
    const cr = container.getBoundingClientRect();
    pop.style.top = `${Math.round(top - cr.top + container.scrollTop)}px`;
    pop.style.left = `${Math.round(left - cr.left + container.scrollLeft)}px`;
  }

  // Defer listener attach so the opening click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  return { el: pop, close };
}

/** A labelled text input that commits on Enter / a button, never submitting a form. */
export function textField(opts: {
  initial?: string; caption?: string; placeholder?: string; submitLabel?: string;
  validate?: (v: string) => boolean; onCommit: (v: string) => void;
}): HTMLElement {
  const wrap = el("div", "exed-field");
  if (opts.caption) wrap.append(el("div", "exed-field-cap", [opts.caption]));
  const input = el("input", "exed-input");
  input.type = "text";
  input.value = opts.initial ?? "";
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const submit = button("exed-btn primary", opts.submitLabel ?? "Apply", () => commit());
  const ok = (): boolean => (opts.validate ? opts.validate(input.value) : true);
  const sync = (): void => { submit.disabled = !ok(); };
  const commit = (): void => { if (ok()) opts.onCommit(input.value); };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commit(); }
  });
  sync();
  wrap.append(el("div", "exed-field-row", [input, submit]));
  setTimeout(() => input.focus(), 0);
  return wrap;
}
