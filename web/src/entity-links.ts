import { resourceHref, currentResource } from "./resource-navigation";
import {
  EntityCatalog,
  entityLabels,
  ipRef,
  entityKey,
  hostRef,
  type EntityRef,
  type Item,
} from "./entity-model";
import "./entity-links.css";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const entities = new EntityCatalog();
export function entityLink(
  ref: EntityRef | null,
  label: unknown,
  description?: string,
): string {
  if (!ref?.id) return esc(label || "—");
  return `<a class="entity-link" data-entity-kind="${esc(ref.kind)}" href="${esc(resourceHref(location.hash.slice(1) || "home", ref.kind === "port" ? { ...ref, kind: "equipment", tab: "ports:" + ref.resourceKind, resourceKind: undefined } : ref))}" title="${esc(description || "Open " + entityLabels[ref.kind] + ": " + label)}">${esc(label)}</a>`;
}
export const addressLink = (address: unknown, scope?: Item) =>
  entityLink(ipRef(address, scope), address);
export const clientLinks = (m: Item) =>
  (m.clients || [])
    .map((c: Item) =>
      entityLink(c.key ? { kind: "client", id: c.key } : null, c.name),
    )
    .join(" · ") || esc(m.client_name || "Unassigned");
export function locationLinks(m: Item) {
  const r = m.resource || m.resources?.[0];
  return r
    ? [
        entityLink(
          r.connection_id ? { kind: "connection", id: r.connection_id } : null,
          r.connection_name,
        ),
        entityLink(hostRef(r, entities.machines), r.node),
      ]
        .filter((v) => v && v !== "—")
        .join(" · ")
    : esc(m.location || m.site || "—");
}
let refresh: (() => void) | undefined;
let catalogRevision = 0;
export function ingestEntities(path: string, data: any) {
  entities.ingest(path, data);
  catalogRevision++;
  refresh?.();
}
export function clearEntities() {
  entities.clear();
}
/** Enhance standalone inventory values, never arbitrary prose, commands or secrets.
 * Explicit scoped links take precedence. Existing controls are left intact. */
export function installEntityLinks() {
  let queued = false,
    enhancedRevision = -1;
  const ignored =
    "a,button,input,textarea,select,option,pre,code,script,style,h1,h2,h3,summary,[contenteditable],.resource-technical,.resource-fields,.keys-secret,.keys-secrets,.secret-value,.remote-stage,.xterm,[data-no-entity-links]";
  const enhance = () => {
    queued = false;
    observer.disconnect();
    if (enhancedRevision !== catalogRevision) {
      document
        .querySelectorAll<HTMLAnchorElement>("a[data-auto-entity]")
        .forEach((a) => {
          const matches = entities.matches(a.textContent || ""),
            ref =
              ipRef(a.textContent) ||
              (matches.length === 1
                ? matches[0].ref
                : matches.length > 1
                  ? ({ kind: "entity-lookup", id: a.textContent! } as EntityRef)
                  : null);
          if (!ref) {
            a.replaceWith(document.createTextNode(a.textContent || ""));
            return;
          }
          const template = document.createElement("template");
          template.innerHTML = entityLink(ref, a.textContent);
          const fresh = template.content.firstElementChild!;
          for (const name of ["href", "title", "data-entity-kind"])
            a.setAttribute(name, fresh.getAttribute(name)!);
        });
      enhancedRevision = catalogRevision;
    }
    for (const root of document.querySelectorAll(
      "#content,dialog.device-drawer",
    )) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) nodes.push(node as Text);
      for (const node of nodes) {
        const parent = node.parentElement,
          text = node.textContent?.trim();
        if (!parent || !text || text.length > 512 || parent.closest(ignored))
          continue;
        // Text in sentences and raw output is intentionally not parsed.
        if (
          !parent.closest(
            "td,dd,.resource-related,.mini-grid,.machine-reach,.machine-inventory,dl,.machine-system",
          )
        )
          continue;
        const matches = entities.matches(text);
        const ref: EntityRef | null =
          ipRef(text) ||
          (matches.length === 1
            ? matches[0].ref
            : matches.length > 1
              ? { kind: "entity-lookup", id: text }
              : null);
        if (
          !ref ||
          (currentResource() &&
            entityKey(ref) === entityKey(currentResource()!))
        )
          continue;
        const template = document.createElement("template");
        template.innerHTML = entityLink(ref, text);
        (template.content.firstElementChild as HTMLElement).dataset.autoEntity =
          "";
        node.replaceWith(template.content);
      }
    }
    observer.observe(document.body, { childList: true, subtree: true });
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          !(
            r.target instanceof Element ? r.target : r.target.parentElement
          )?.closest(ignored),
      )
    )
      schedule();
  });
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(enhance);
    }
  };
  refresh = schedule;
  schedule();
}
