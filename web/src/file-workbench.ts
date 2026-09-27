import {
  escapeDetail as e,
  capacity,
  detailDate,
  detailFacts as facts,
  detailSection as section,
  technicalDetail,
} from "./resource-story";
import { listWorkspace } from "./list-workspace";
type Item = Record<string, any>;
export function parentDirectory(path: string, windows = false) {
  const separator = windows ? "\\" : "/";
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(
    trimmed.lastIndexOf("/"),
    windows ? trimmed.lastIndexOf("\\") : -1,
  );
  if (at < 0) return windows ? trimmed + separator : "/";
  const parent = trimmed.slice(0, at) || separator;
  return windows && /^[A-Za-z]:$/.test(parent) ? parent + "\\" : parent;
}
export function mountFiles(ui: Item, d: Item, root: HTMLElement) {
  let directory = d.platform === "windows" ? "C:\\ProgramData" : "/tmp",
    generation = 0;
  const windows = d.platform === "windows";
  root.innerHTML = `<div class="resource-section"><h3>Files on ${e(d.label)}</h3><p class="resource-note">Agent account: ${windows ? "Local System" : "service account (normally root)"}. Transfers are verified with SHA-256; up to 256 MiB. Existing files are preserved.</p></div><div class="toolbar"><label class="list-search">Directory or full file path<input id="file-path" value="${e(directory)}" spellcheck="false"></label><button id="browse" class="secondary">List</button><button id="file-parent" class="secondary">Up</button><button id="download" class="secondary">Download</button></div><nav aria-label="File path" data-file-crumbs></nav><div data-file-list><p class="resource-note">Choose List to read this directory from the agent.</p></div><section class="resource-section"><h3>Upload a file</h3><div class="toolbar"><input id="file-upload" aria-label="Choose file to upload" type="file"><button id="upload" class="primary">Upload to this directory</button></div><p data-transfer-progress role="status"></p></section><section data-transfers></section>`;
  const input = root.querySelector<HTMLInputElement>("#file-path")!;
  const list = root.querySelector<HTMLElement>("[data-file-list]")!;
  const progress = root.querySelector<HTMLElement>("[data-transfer-progress]")!;
  const manageable = !!d.approved && !d.archived && !d.revoked && !!d.online;
  if (!manageable) {
    root
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    list.textContent =
      "An online, approved agent is required to browse files. Recorded transfers remain available below.";
  }
  async function wait(id: string) {
    for (let i = 0; i < 100 && root.isConnected; i++) {
      const job = await ui.api("/jobs/" + encodeURIComponent(id));
      if (!["queued", "leased", "running"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(
      "The result is still pending. Inspect the job or refresh transfers for its final outcome.",
    );
  }
  async function browse(path = input.value) {
    const version = ++generation;
    list.innerHTML =
      '<p class="resource-note" role="status">Reading directory from the agent…</p>';
    try {
      const queued = await ui.api("/devices/" + d.id + "/jobs", "POST", {
        kind: "files.list",
        payload: { path },
        timeout: 60,
      });
      const job = await wait(queued.id);
      if (!root.isConnected || version !== generation) return;
      if (job.status !== "complete" || !Array.isArray(job.result?.entries))
        throw new Error(
          job.result?.error ||
            "Directory listing " +
              job.status +
              ". Inspect job " +
              queued.id +
              " for the result.",
        );
      directory = job.result.path;
      input.value = directory;
      const entries: Item[] = [...job.result.entries].sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
      const crumbs = root.querySelector<HTMLElement>("[data-file-crumbs]")!;
      const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean);
      const paths = parts.map((_, i) =>
        windows
          ? parts.slice(0, i + 1).join("\\") + "\\"
          : "/" + parts.slice(0, i + 1).join("/"),
      );
      crumbs.innerHTML =
        (windows ? "" : '<button class="text-link" data-file-root>/</button>') +
        parts
          .map(
            (part, i) =>
              `<span aria-hidden="true"> / </span><button class="text-link" data-file-crumb="${i}">${e(part)}</button>`,
          )
          .join("");
      crumbs
        .querySelectorAll<HTMLButtonElement>("[data-file-crumb]")
        .forEach(
          (b) =>
            (b.onclick = () => void browse(paths[Number(b.dataset.fileCrumb)])),
        );
      crumbs
        .querySelector<HTMLButtonElement>("[data-file-root]")
        ?.addEventListener("click", () => void browse("/"));
      list.innerHTML = `<div class="scroll"><table><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead><tbody>${entries.map((entry, i) => `<tr><td><button class="text-link" data-file="${i}">${entry.directory ? "▸ " : ""}${e(entry.name)}</button></td><td>${entry.symlink ? "Symbolic link" : entry.directory ? "Directory" : "File"}</td><td>${entry.directory ? "—" : e(capacity(entry.size))}</td><td>${e(detailDate(entry.modified))}</td></tr>`).join("")}</tbody></table></div><p class="resource-note">${entries.length} entries · read ${new Date().toLocaleTimeString()}. ${job.result.truncated ? "The agent limited this result to 1,000 entries." : ""}</p>`;
      listWorkspace(list, "tbody tr", "files on " + d.id);
      list.querySelectorAll<HTMLButtonElement>("[data-file]").forEach(
        (b) =>
          (b.onclick = () => {
            const entry = entries[Number(b.dataset.file)];
            if (entry.directory && !entry.symlink) void browse(entry.path);
            else {
              input.value = entry.path;
              const pane: HTMLDialogElement = ui.flyout(
                entry.name,
                facts([
                  ["Path", entry.path],
                  ["Size", capacity(entry.size)],
                  ["Modified", detailDate(entry.modified)],
                  ["Type", entry.symlink ? "Symbolic link" : "File"],
                  ["Machine", d.label],
                ]) +
                  '<p class="resource-note">Download requires a separate request and SHA-256 verification.</p><button class="primary" data-file-download>Request download</button>',
                { tone: "agents" },
              );
              pane.querySelector<HTMLButtonElement>(
                "[data-file-download]",
              )!.onclick = () => {
                pane.close();
                void download(entry.path);
              };
            }
          }),
      );
    } catch (error) {
      if (root.isConnected && version === generation)
        list.textContent = (error as Error).message;
    }
  }
  async function transfers() {
    const rows = await ui.api(
      "/transfers?device_id=" + encodeURIComponent(d.id),
    );
    if (!root.isConnected) return;
    const target = root.querySelector<HTMLElement>("[data-transfers]")!;
    target.innerHTML =
      '<h3>Transfer receipts</h3><div class="resource-related">' +
      rows
        .map(
          (r: Item, i: number) =>
            `<button data-transfer="${i}"><span><b>${e(r.name)}</b><small>${e(r.direction)} · ${e(capacity(r.size))} · ${e(detailDate(r.created))}</small></span><span>${e(r.status)} →</span></button>`,
        )
        .join("") +
      "</div>" +
      (!rows.length
        ? '<p class="resource-note">No transfers recorded.</p>'
        : "") +
      '<button class="text-link" data-transfer-refresh>Refresh receipts</button>';
    target.querySelector<HTMLButtonElement>(
      "[data-transfer-refresh]",
    )!.onclick = () => void transfers();
    target.querySelectorAll<HTMLButtonElement>("[data-transfer]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = rows[Number(b.dataset.transfer)];
          const pane: HTMLDialogElement = ui.flyout(
            r.name,
            section(
              "Transfer receipt",
              facts([
                ["Direction", r.direction],
                ["State", r.status],
                ["Path", r.path],
                ["Size", capacity(r.size)],
                ["Created", detailDate(r.created)],
                ["SHA-256", r.sha256],
                ["Machine", d.label],
              ]),
            ) +
              `<div class="toolbar">${r.status === "ready" && r.direction === "download" ? `<a class="primary" href="/api/transfers/${encodeURIComponent(r.id)}/file">Save verified file</a>` : ""}${r.job_id ? '<button class="secondary" data-transfer-job>Inspect agent result</button>' : ""}</div>` +
              technicalDetail(r),
            { tone: "agents" },
          );
          pane
            .querySelector<HTMLButtonElement>("[data-transfer-job]")
            ?.addEventListener("click", () => void ui.showJob(r.job_id));
        }),
    );
  }
  async function download(path = input.value) {
    progress.textContent = "Requesting file from the agent…";
    try {
      const result = await ui.api(
        "/devices/" + d.id + "/files/download",
        "POST",
        { path },
      );
      const job = await wait(result.job_id);
      if (!root.isConnected) return;
      progress.textContent =
        job.status === "complete"
          ? "Transfer finished. Open its receipt to save the verified file."
          : "Transfer " + job.status + ". Inspect its receipt before retrying.";
      await transfers();
    } catch (error) {
      if (root.isConnected) progress.textContent = (error as Error).message;
    }
  }
  root.querySelector<HTMLButtonElement>("#browse")!.onclick = () =>
    void browse();
  root.querySelector<HTMLButtonElement>("#file-parent")!.onclick = () =>
    void browse(parentDirectory(directory, windows));
  root.querySelector<HTMLButtonElement>("#download")!.onclick = () =>
    void download();
  root.querySelector<HTMLButtonElement>("#upload")!.onclick = async (event) => {
    const uploadButton = event.currentTarget as HTMLButtonElement;
    const file =
      root.querySelector<HTMLInputElement>("#file-upload")!.files?.[0];
    if (!file) {
      progress.textContent = "Choose a file to upload.";
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      progress.textContent = "This file exceeds 256 MiB.";
      return;
    }
    const path =
      directory.replace(/[\\/]+$/, "") + (windows ? "\\" : "/") + file.name;
    const confirm: HTMLDialogElement = ui.dialog(
      "Review file upload",
      facts([
        ["Machine", d.label],
        ["Destination", path],
        ["Size", capacity(file.size)],
      ]) +
        '<p>Existing files will not be overwritten.</p><button class="primary" data-upload-confirm>Upload file</button>',
    );
    confirm.querySelector<HTMLButtonElement>("[data-upload-confirm]")!.onclick =
      async () => {
        confirm.close();
        const button = uploadButton;
        button.disabled = true;
        progress.textContent =
          "Uploading " + capacity(file.size) + " to Speck…";
        try {
          const form = new FormData();
          form.append("file", file);
          const result = await ui.api(
            "/devices/" +
              d.id +
              "/files/upload?path=" +
              encodeURIComponent(path),
            "POST",
            form,
          );
          progress.textContent =
            "Upload received. Waiting for the agent to verify and save the file…";
          const job = await wait(result.job_id);
          if (root.isConnected) {
            progress.textContent =
              job.status === "complete"
                ? "Agent finished. Inspect the receipt for checksum and outcome."
                : "Agent reported " +
                  job.status +
                  ". Inspect the receipt before retrying.";
            await transfers();
          }
        } catch (error) {
          if (root.isConnected) progress.textContent = (error as Error).message;
        } finally {
          button.disabled = false;
        }
      };
  };
  void transfers().catch((error) => {
    if (root.isConnected)
      root.querySelector("[data-transfers]")!.textContent = error.message;
  });
}
