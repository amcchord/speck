import { columns, defaultPreferences, type FleetPreferences } from "./fleet-model";
import { icon } from "./icons";

type OpenDialog = (title: string, html: string, options: { className: string }) => HTMLDialogElement;

export function editColumns(preferences: FleetPreferences, openDialog: OpenDialog, save: (draft: FleetPreferences) => void) {
  const draft = structuredClone(preferences);
  const d = openDialog("Customize columns", `
    <p class="columns-intro" id="columns-help">Choose what appears in Fleet. Drag the handles to reorder, or focus a handle and use the arrow keys.</p>
    <div class="columns-toolbar"><span id="columns-count"></span><label><input id="columns-widths" type="checkbox">Adjust widths</label></div>
    <div class="columns-list" tabindex="-1"><ol id="column-options" aria-label="Fleet columns"></ol></div>
    <p class="columns-announcement" role="status" aria-live="polite" aria-atomic="true"></p>
    <div class="columns-footer"><button id="columns-reset" class="text-link">Reset defaults</button><div><button id="columns-cancel" class="secondary">Cancel</button><button id="columns-save" class="primary">Save columns</button></div></div>
  `, { className: "columns-dialog" });
  const list = d.querySelector<HTMLElement>(".columns-list")!;
  const options = d.querySelector<HTMLOListElement>("#column-options")!;
  const status = d.querySelector<HTMLElement>(".columns-announcement")!;
  const announce = (text: string) => { status.textContent = text; };
  const count = () => { d.querySelector("#columns-count")!.textContent = `${draft.visible.length} of ${draft.order.length} visible`; };

  function draw(focusKey?: string) {
    options.innerHTML = draft.order.map(key => `<li class="column-option ${draft.visible.includes(key) ? "is-visible" : ""}" data-column-key="${key}">
      <button type="button" class="column-handle" data-column-handle="${key}" aria-label="Reorder ${columns[key].label}" aria-describedby="columns-help" title="Drag to reorder, or use ↑ and ↓">${icon("grip")}</button>
      <label class="column-choice"><input type="checkbox" data-column-toggle="${key}" ${draft.visible.includes(key) ? "checked" : ""} ${key === "name" ? "disabled" : ""}><span>${columns[key].label}</span>${key === "name" ? '<small>Required</small>' : ""}</label>
      <label class="column-width"><input type="number" min="64" max="640" value="${draft.widths[key] || columns[key].width}" data-column-width="${key}" aria-label="${columns[key].label} width"><span>px</span></label>
    </li>`).join("");
    count();
    if (focusKey) {
      const handle = options.querySelector<HTMLButtonElement>(`[data-column-handle="${focusKey}"]`)!;
      handle.focus({ preventScroll: true });
      handle.closest("li")!.scrollIntoView({ block: "nearest" });
    }
  }

  function move(key: string, index: number) {
    const from = draft.order.indexOf(key);
    draft.order.splice(from, 1);
    draft.order.splice(index, 0, key);
    draw(key);
    announce(`${columns[key].label} moved to position ${index + 1} of ${draft.order.length}.`);
  }

  options.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.columnToggle;
    if (key && key !== "name") {
      draft.visible = input.checked ? [...draft.visible, key] : draft.visible.filter(k => k !== key);
      input.closest("li")!.classList.toggle("is-visible", input.checked);
      count();
    }
    const widthKey = input.dataset.columnWidth;
    if (widthKey) {
      draft.widths[widthKey] = Math.min(640, Math.max(64, Math.round(Number(input.value) || 64)));
      input.value = String(draft.widths[widthKey]);
    }
  });

  // Pointer capture keeps mouse, pen and touch dragging on the handle, leaving
  // the rest of the list free for normal scrolling and checkbox interaction.
  let drag: { key: string; pointer: number; handle: HTMLButtonElement; row: HTMLElement; startX: number; startY: number; y: number; offsetY: number; index: number; ghost?: HTMLElement } | undefined;
  let frame = 0;
  function clearMarkers() {
    options.querySelectorAll(".drop-before, .drop-after").forEach(el => el.classList.remove("drop-before", "drop-after"));
  }
  function placeMarker() {
    if (!drag?.ghost) return;
    const rows = [...options.querySelectorAll<HTMLElement>("li")].filter(row => row !== drag!.row);
    const below = rows.findIndex(row => { const box = row.getBoundingClientRect(); return drag!.y < box.y + box.height / 2; });
    drag.index = below === -1 ? rows.length : below;
    clearMarkers();
    if (below === -1) rows.at(-1)?.classList.add("drop-after");
    else rows[below].classList.add("drop-before");
    const bounds = list.getBoundingClientRect();
    drag.ghost.style.top = `${Math.max(bounds.top, Math.min(drag.y - drag.offsetY, bounds.bottom - drag.ghost.offsetHeight))}px`;
  }
  function scrollDuringDrag() {
    if (!drag?.ghost) return;
    const bounds = list.getBoundingClientRect();
    const edge = 48;
    const speed = drag.y < bounds.top + edge ? -Math.min(12, (bounds.top + edge - drag.y) / 4)
      : drag.y > bounds.bottom - edge ? Math.min(12, (drag.y - bounds.bottom + edge) / 4) : 0;
    if (speed) { list.scrollTop += speed; placeMarker(); }
    frame = requestAnimationFrame(scrollDuringDrag);
  }
  function finishDrag(commit: boolean) {
    if (!drag) return;
    const ended = drag;
    drag = undefined;
    cancelAnimationFrame(frame);
    ended.ghost?.remove();
    ended.row.classList.remove("is-dragging");
    d.classList.remove("is-reordering");
    clearMarkers();
    if (ended.handle.hasPointerCapture(ended.pointer)) ended.handle.releasePointerCapture(ended.pointer);
    if (ended.ghost && commit) move(ended.key, ended.index);
    else if (ended.ghost) announce("Reordering canceled.");
  }
  options.addEventListener("pointerdown", event => {
    const handle = (event.target as Element).closest<HTMLButtonElement>("[data-column-handle]");
    if (!handle || event.button !== 0 || !event.isPrimary || drag) return;
    const row = handle.closest<HTMLElement>("li")!;
    const key = handle.dataset.columnHandle!;
    drag = { key, pointer: event.pointerId, handle, row, startX: event.clientX, startY: event.clientY, y: event.clientY, offsetY: event.clientY - row.getBoundingClientRect().top, index: draft.order.indexOf(key) };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    event.preventDefault();
  });
  options.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.y = event.clientY;
    if (!drag.ghost && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
      const bounds = drag.row.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "column-drag-preview";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = `${icon("grip")}<span>${columns[drag.key].label}</span>`;
      Object.assign(ghost.style, { left: `${bounds.left}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
      d.append(ghost);
      drag.ghost = ghost;
      drag.row.classList.add("is-dragging");
      d.classList.add("is-reordering");
      frame = requestAnimationFrame(scrollDuringDrag);
    }
    placeMarker();
  });
  options.addEventListener("pointerup", event => { if (event.pointerId === drag?.pointer) finishDrag(true); });
  options.addEventListener("pointercancel", () => finishDrag(false));
  options.addEventListener("lostpointercapture", () => finishDrag(false));
  d.addEventListener("close", () => finishDrag(false));
  d.addEventListener("keydown", event => {
    if (drag) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishDrag(false); }
      return;
    }
    const key = (event.target as HTMLElement).dataset.columnHandle;
    if (!key || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const from = draft.order.indexOf(key);
    const to = event.key === "Home" ? 0 : event.key === "End" ? draft.order.length - 1 : Math.max(0, Math.min(draft.order.length - 1, from + (event.key === "ArrowUp" ? -1 : 1)));
    if (to !== from) move(key, to);
  });

  d.querySelector<HTMLInputElement>("#columns-widths")!.onchange = event => {
    d.classList.toggle("show-widths", (event.target as HTMLInputElement).checked);
  };
  d.querySelector<HTMLButtonElement>("#columns-reset")!.onclick = () => {
    const defaults = defaultPreferences();
    Object.assign(draft, { order: defaults.order, visible: defaults.visible, widths: defaults.widths });
    draw();
    list.scrollTop = 0;
    announce("Default columns restored. Save to apply.");
  };
  d.querySelector<HTMLButtonElement>("#columns-cancel")!.onclick = () => d.close();
  d.querySelector<HTMLButtonElement>("#columns-save")!.onclick = () => { d.close(); save(draft); };
  draw();
}
