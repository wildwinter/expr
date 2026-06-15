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

/** A <button type=button> with a class, label, and click handler. */
export function button(cls: string, label: string | Node, onClick: (e: MouseEvent) => void, title?: string): HTMLButtonElement {
  const b = el("button", cls, [label]);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

export const clear = (node: HTMLElement): void => node.replaceChildren();

export interface Popover {
  el: HTMLElement;
  close(): void;
}

/**
 * Open a floating popover anchored under `anchor`. `render(close)` builds the
 * content (call `close` to dismiss). Closes on Escape and on a pointer-down
 * outside the popover or the anchor. Only one popover lives at a time per call;
 * the caller tracks the handle to close it programmatically.
 */
export function openPopover(anchor: HTMLElement, render: (close: () => void) => Node): Popover {
  const pop = el("div", "exed-pop");
  const close = (): void => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    pop.remove();
  };
  const onDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

  pop.append(render(close));
  document.body.append(pop);

  // Position: under the anchor, flipped up if it would overflow the viewport.
  const a = anchor.getBoundingClientRect();
  const ph = pop.getBoundingClientRect();
  let top = a.bottom + 4;
  if (top + ph.height > window.innerHeight - 8 && a.top - ph.height - 4 > 8) top = a.top - ph.height - 4;
  let left = a.left;
  if (left + ph.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - ph.width);
  pop.style.top = `${Math.round(top + window.scrollY)}px`;
  pop.style.left = `${Math.round(left + window.scrollX)}px`;

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
