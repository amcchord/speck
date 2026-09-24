/**
 * Touch and narrow-screen enhancements shared by every page.
 *
 * Tables: each data table is marked so that, in a container narrower than 720px, rows become
 * two-line list items (title and status on the first line, facts beneath, actions at the end).
 * Cells are classified from their content, so pages keep a single table markup.
 *
 * Toolbars: on phones, filter controls fold behind one "Filters" button that counts active filters.
 */
import { icon } from "./icons";

const WRAPPERS = ["infra-table-wrap", "scroll", "table-wrap", "pve-table", "m-host"];
const onlyChildren = (cell: Element, selector: string) =>
  cell.children.length > 0 && [...cell.children].every((child) => child.matches(selector)) && !textOutside(cell);
const textOutside = (cell: Element) =>
  [...cell.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
const factLike = (text: string) => text.length <= 28 && (/\d/.test(text) || /^(never|none)$/i.test(text));
const ADDRESS = /^(\d{1,3}\.){3}\d{1,3}(\/\d+)?$|^[\da-f]*:[\da-f:]+$/i;
const CHIPS = ".badge, .net-chip, .chip";
// "Memory / capacity" reads as "Memory"; times under "When" and bare addresses need no label.
const factLabel = (heading: string, text: string) =>
  heading && !/^(when|value)$/i.test(heading) && factLike(text) && !ADDRESS.test(text) ? heading.split(" / ")[0] : "";
const chipOnly = (cell: Element) => onlyChildren(cell, CHIPS) && cell.children.length <= 2;

function listTable(table: HTMLTableElement) {
  if (table.closest(".fleet-table-wrap, .no-list") || table.classList.contains("fleet-table")) return;
  const parent = table.parentElement;
  if (!parent) return;
  if (!WRAPPERS.some((name) => parent.classList.contains(name))) {
    const host = document.createElement("div");
    host.className = "m-host";
    parent.insertBefore(host, table);
    host.append(table);
  } else parent.classList.add("m-host");
  table.classList.add("m-list");
  const headings = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() || "");
  table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => {
    if (row.dataset.listed === "1") return;
    row.dataset.listed = "1";
    const cells = [...row.children] as HTMLElement[];
    if (cells.length === 1 || cells.every((cell) => cell.tagName === "TH")) {
      row.classList.add("m-group");
      return;
    }
    let title: HTMLElement | null = null;
    // The status chip sits at the end of the first line; prefer a Status/State column, else the first chip.
    const status = cells.find((cell, i) => i > 0 && /status|state|kind/i.test(headings[i] || "") && chipOnly(cell)) || cells.find((cell, i) => i > 0 && chipOnly(cell));
    cells.forEach((cell, i) => {
      const text = cell.textContent?.trim() || "";
      if (onlyChildren(cell, 'input[type="checkbox"]')) return cell.classList.add("m-select");
      if (!title && cell.tagName === "TD") {
        title = cell;
        return cell.classList.add("m-title");
      }
      // Only missing values disappear; muted facts such as "Proxmox only" still read as facts.
      if (!text || text === "—") return cell.classList.add("m-empty");
      if (onlyChildren(cell, "button, select, a.secondary, a.primary, .quick-action")) return cell.classList.add("m-actions");
      if (cell === status) return cell.classList.add("m-end");
      cell.classList.add("m-meta");
      // Chips read as facts once they carry their column name ("Two-factor Not enabled").
      const label = cell.querySelector("button, details") ? "" : chipOnly(cell) && headings[i] ? headings[i] : factLabel(headings[i] || "", text);
      if (label) cell.dataset.m = label;
    });
    row.querySelector(".m-meta")?.classList.add("m-first");
  });
  if (table.dataset.listed) return;
  table.dataset.listed = "1";
  // In list mode the whole row opens its item, like the title link it carries.
  table.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!table.matches(".m-list") || getComputedStyle(table.tHead || table).display !== "none") return;
    if (target.closest("button, a, input, select, summary, details, label, pre")) return;
    const row = target.closest("tr");
    const open = row?.querySelector<HTMLElement>(".m-title button, .m-title a, .m-title summary");
    open?.click();
  });
}

function filterCount(toolbar: HTMLElement) {
  let count = 0;
  toolbar.querySelectorAll<HTMLElement>(".m-filter").forEach((label) => {
    label.querySelectorAll<HTMLInputElement | HTMLSelectElement>("select, input").forEach((field) => {
      if (field instanceof HTMLSelectElement) {
        if (field.selectedIndex > 0) count++;
      } else if (field.type !== "checkbox" && field.value.trim()) count++;
    });
  });
  return count;
}

// Pages re-render their toolbar after a filter change; an open filter panel stays open.
const openToolbars = new Set<string>();
function foldToolbar(toolbar: HTMLElement) {
  if (toolbar.dataset.folded) return;
  const collapseAll = toolbar.classList.contains("audit-filters");
  const filters = [...toolbar.children].filter((child) => {
    if (child.classList.contains("infra-search")) return false;
    if (collapseAll) return true;
    return child.tagName === "LABEL" && !!child.querySelector("select, input:not([type=search]):not([type=checkbox])");
  }) as HTMLElement[];
  if (!filters.length) return;
  toolbar.dataset.folded = "1";
  toolbar.classList.add("m-foldable");
  filters.forEach((el) => el.classList.add("m-filter"));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "secondary m-filter-toggle";
  toggle.setAttribute("aria-expanded", "false");
  const paint = () => {
    const n = filterCount(toolbar);
    toggle.innerHTML = `${icon("filter")}<span>Filters</span>${n ? `<b class="m-filter-count">${n}</b>` : ""}`;
  };
  paint();
  const key = location.hash.split("/")[0] + "|" + toolbar.className.split(" ")[0];
  const setOpen = (open: boolean) => {
    toolbar.classList.toggle("m-filters-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) openToolbars.add(key);
    else openToolbars.delete(key);
  };
  setOpen(openToolbars.has(key));
  toggle.addEventListener("click", () => setOpen(!toolbar.classList.contains("m-filters-open")));
  toolbar.addEventListener("change", paint);
  toolbar.addEventListener("input", paint);
  const search = toolbar.querySelector(".infra-search");
  if (search) search.after(toggle);
  else toolbar.prepend(toggle);
}

// Keep the active tab of a sideways-scrolling tab row in view.
function revealActiveTab(tabs: HTMLElement) {
  const active = tabs.querySelector<HTMLElement>(".active, [aria-selected=true], [aria-pressed=true]");
  if (!active || tabs.scrollWidth <= tabs.clientWidth || tabs.dataset.revealed === active.textContent) return;
  tabs.dataset.revealed = active.textContent || "";
  tabs.scrollLeft = Math.max(0, active.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2);
}

let queued = false;
function enhance() {
  queued = false;
  document.querySelectorAll<HTMLElement>(".infra-tabs, .device-drawer .tabs").forEach(revealActiveTab);
  document.querySelectorAll<HTMLTableElement>("#content table, dialog table").forEach(listTable);
  document.querySelectorAll<HTMLElement>("#content .infra-toolbar, #content .alerts-toolbar, #content .audit-filters").forEach(foldToolbar);
}

/** Watch the document so tables and toolbars rendered later by any page are enhanced too. */
export function startResponsive() {
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }).observe(document.body, { childList: true, subtree: true });
  enhance();
}
