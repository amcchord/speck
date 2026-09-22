import { icon } from "./icons";

// Advance this only after all platform artifacts and SHA256SUMS are published.
const version = "0.2.2";
const release = `https://github.com/amcchord/speck/releases/tag/v${version}`;
const assets = `https://github.com/amcchord/speck/releases/download/v${version}`;
const installer = (file: string, label: string, primary = false) =>
  `<a class="${primary ? "primary" : "secondary"}" target="_blank" rel="noopener" href="${assets}/Speck-Desktop-${version}-${file}">${icon("download")}${label}</a>`;

export function desktopDownloads(signedIn: boolean) {
  return `<div class="downloads">
    <div class="download-intro">
      <img src="/assets/brand/speck-icon.svg" alt="" width="64" height="64">
      <div><div class="download-title"><h2>Speck Desktop</h2><span class="download-version">v${version}</span></div>
      <p>Your remote workspace, with shared clipboard and native key shortcuts.</p></div>
    </div>
    <div class="download-grid">
      <article class="download-card" aria-labelledby="download-windows">
        <span class="download-platform">${icon("windows")}</span>
        <h3 id="download-windows">Windows</h3><p class="download-architecture">64-bit · x64</p>
        <div class="download-buttons">${installer("win-x64.exe", "Download for Windows", true)}</div>
        <p class="download-note">EXE installer · unsigned</p>
      </article>
      <article class="download-card" aria-labelledby="download-mac">
        <span class="download-platform">${icon("laptop")}</span>
        <h3 id="download-mac">macOS</h3><p class="download-architecture">Apple silicon or Intel</p>
        <div class="download-buttons">${installer("mac-arm64.dmg", "Apple silicon", true)}${installer("mac-x64.dmg", "Intel Mac")}</div>
        <p class="download-note">DMG installers · signed &amp; notarized</p>
        <details class="download-alternatives"><summary>ZIP downloads</summary><a target="_blank" rel="noopener" href="${assets}/Speck-Desktop-${version}-mac-arm64.zip">Apple silicon ZIP</a><a target="_blank" rel="noopener" href="${assets}/Speck-Desktop-${version}-mac-x64.zip">Intel Mac ZIP</a></details>
      </article>
      <article class="download-card" aria-labelledby="download-linux">
        <span class="download-platform">${icon("linux")}</span>
        <h3 id="download-linux">Linux</h3><p class="download-architecture">64-bit · x64</p>
        <div class="download-buttons">${installer("linux-amd64.deb", "Download .deb", true)}${installer("linux-x86_64.AppImage", "Download AppImage")}</div>
        <p class="download-note">Debian / Ubuntu or portable AppImage</p>
      </article>
    </div>
    <section class="download-setup" aria-labelledby="download-setup-title">
      <div><h3 id="download-setup-title">Get started</h3><p>Install Speck Desktop, open it, and sign in. To launch remote sessions in the app, choose <strong>Speck Desktop</strong> in ${signedIn ? '<a href="#settings">Settings → Remote workspace</a>' : "Settings → Remote workspace"}.</p></div>
      <div class="download-resources"><a href="${release}" target="_blank" rel="noopener">Release notes ${icon("arrow")}</a><a target="_blank" rel="noopener" href="${assets}/SHA256SUMS">SHA256 checksums ${icon("arrow")}</a></div>
    </section>
    <p class="download-agent-note">Setting up a managed machine? ${signedIn ? '<a href="#fleet">Add a device from Fleet</a>' : '<a href="#signin">Sign in to add a device</a>'} to install the Speck Agent.</p>
  </div>`;
}
