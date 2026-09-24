// Label each cell with its column heading so phone layouts can stack rows as cards.
export function cardify(root: ParentNode | null) {
  root?.querySelectorAll<HTMLTableElement>("table.net-table").forEach((table) => {
    table.classList.add("net-cards");
    const headings = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() || "");
    table.querySelectorAll("tbody tr").forEach((row) =>
      [...row.children].forEach((cell, i) => {
        if (headings[i]) cell.setAttribute("data-label", headings[i]);
        else cell.classList.add("net-cell-actions");
      }),
    );
  });
}
