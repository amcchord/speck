// Rebuild shared brand assets. Run after npm --prefix web ci.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "web/package.json"));
const { Resvg } = require("@resvg/resvg-js");
const brand = JSON.parse(
  fs.readFileSync(path.join(root, "brand/identity.json"), "utf8"),
);
const c = brand.colors;
const dir = path.join(root, "brand/assets");
fs.mkdirSync(dir, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
const rays =
  Array.from(
    { length: 8 },
    (_, i) =>
      `<rect x="29" y="4" width="6" height="19" rx="3" transform="rotate(${i * 45} 32 32)"/>`,
  ).join("") + '<circle cx="32" cy="32" r="3"/>';
const mark = (color) => `<g fill="${color}">${rays}</g>`;
const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
const outline = fs.readFileSync(
  path.join(root, "brand/wordmark-path.svg"),
  "utf8",
);
const lettering = outline.match(/<path[^>]+\/>/)[0];
const wordWidth = Number(outline.match(/viewBox="0 0 ([\d.]+) 80"/)[1]);
for (const [variant, color] of [
  ["forest", c.forest],
  ["lime", c.lime],
  ["white", c.white],
  ["black", "#000000"],
]) {
  write(`speck-mark-${variant}.svg`, svg(64, 64, mark(color)));
  write(
    `speck-wordmark-${variant}.svg`,
    svg(
      wordWidth + 84,
      80,
      `<g transform="translate(0 8)">${mark(color)}</g><g fill="${color}" transform="translate(84 0)">${lettering}</g>`,
    ),
  );
}
const tile = svg(
  64,
  64,
  `<rect width="64" height="64" rx="14" fill="${c.forest}"/><g transform="translate(8 8) scale(.75)">${mark(c.lime)}</g>`,
);
write("speck-icon.svg", tile);
// Desktop application icon needs a full-resolution source for macOS packaging.
const desktopAssets = path.join(root, "desktop/assets");
if (fs.existsSync(desktopAssets)) {
  fs.writeFileSync(
    path.join(desktopAssets, "speck-icon-1024.png"),
    new Resvg(tile, { fitTo: { mode: "width", value: 1024 } }).render().asPng(),
  );
  // NSIS expects BMP artwork. Export our vectors directly, preserving the shared palette.
  const bitmap = (artwork, width, height) => {
    const pixels = new Resvg(artwork).render().pixels;
    const stride = (width * 3 + 3) & ~3;
    const result = Buffer.alloc(54 + stride * height);
    result.write("BM"); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10);
    result.writeUInt32LE(40, 14); result.writeInt32LE(width, 18); result.writeInt32LE(height, 22);
    result.writeUInt16LE(1, 26); result.writeUInt16LE(24, 28); result.writeUInt32LE(stride * height, 34);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = 54 + (height - 1 - y) * stride + x * 3;
      result[dst] = pixels[src + 2]; result[dst + 1] = pixels[src + 1]; result[dst + 2] = pixels[src];
    }
    return result;
  };
  const lockup = (color) => `<g transform="translate(0 8)">${mark(color)}</g><g fill="${color}" transform="translate(84 0)">${lettering}</g>`;
  const sidebar = svg(164, 314, `<rect width="164" height="314" fill="${c.forest}"/><g transform="translate(18 24) scale(${128 / (wordWidth + 84)})">${lockup(c.lime)}</g><g fill="none" stroke="${c.fern}" stroke-width=".7"><circle cx="82" cy="200" r="49"/><circle cx="82" cy="200" r="71"/><circle cx="82" cy="200" r="95"/></g><g transform="translate(58 176) scale(.75)">${mark(c.lime)}</g><circle cx="130" cy="145" r="3" fill="${c.lime}"/>`);
  const header = svg(150, 57, `<rect width="150" height="57" fill="${c.white}"/><g transform="translate(9 13) scale(${132 / (wordWidth + 84)})">${lockup(c.forest)}</g>`);
  fs.writeFileSync(path.join(desktopAssets, "installer-sidebar.bmp"), bitmap(sidebar, 164, 314));
  fs.writeFileSync(path.join(desktopAssets, "installer-header.bmp"), bitmap(header, 150, 57));
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) =>
  new Resvg(tile, { fitTo: { mode: "width", value: size } }).render().asPng(),
);
for (let i = 0; i < sizes.length; i++)
  write(`speck-icon-${sizes[i]}.png`, pngs[i]);
const ico = Buffer.alloc(6 + 16 * sizes.length);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(sizes.length, 4);
let offset = ico.length;
for (let i = 0; i < sizes.length; i++) {
  const pos = 6 + 16 * i;
  ico[pos] = ico[pos + 1] = sizes[i] % 256;
  ico.writeUInt16LE(1, pos + 4);
  ico.writeUInt16LE(32, pos + 6);
  ico.writeUInt32LE(pngs[i].length, pos + 8);
  ico.writeUInt32LE(offset, pos + 12);
  offset += pngs[i].length;
}
write("speck.ico", Buffer.concat([ico, ...pngs]));
if (fs.existsSync(desktopAssets)) {
  fs.copyFileSync(
    path.join(dir, "speck.ico"),
    path.join(desktopAssets, "speck.ico"),
  );
  fs.copyFileSync(
    path.join(dir, "speck-icon-256.png"),
    path.join(desktopAssets, "speck-icon-256.png"),
  );
}
write(
  "speck-apple-touch.png",
  new Resvg(tile, { fitTo: { mode: "width", value: 180 } }).render().asPng(),
);
const vars = Object.entries(c)
  .map(([key, v]) => `  --${key}: ${v};`)
  .join("\n");
fs.writeFileSync(
  path.join(root, "brand/tokens.css"),
  `/* Generated from brand/identity.json by scripts/brand.mjs. */\n:root {\n${vars}\n  --green: var(--fern);\n  --radius: 10px;\n  --space: 4px;\n}\n`,
);
const publicDir = path.join(root, "web/public/assets/brand");
fs.mkdirSync(publicDir, { recursive: true });
for (const name of fs.readdirSync(dir))
  fs.copyFileSync(path.join(dir, name), path.join(publicDir, name));
fs.copyFileSync(
  path.join(root, "brand/fonts/InterVariable.woff2"),
  path.join(publicDir, "InterVariable.woff2"),
);
fs.copyFileSync(
  path.join(root, "brand/fonts/OFL.txt"),
  path.join(publicDir, "OFL.txt"),
);
for (const [command, description] of [
  ["speck-agent", "Speck Agent"],
  ["speck-desktop", "Speck Desktop Helper"],
]) {
  const resource = {
    RT_GROUP_ICON: { APP: { "0000": "../assets/speck.ico" } },
    RT_VERSION: {
      "#1": {
        "0409": {
          fixed: { file_version: "0.2.2.0", product_version: "0.2.2.0" },
          info: {
            "0409": {
              CompanyName: "Speck contributors",
              FileDescription: description,
              ProductName: "Speck RMM",
              ProductVersion: "0.2.2",
              FileVersion: "0.2.2",
              OriginalFilename: command + ".exe",
              InternalName: command,
              Comments: brand.tagline,
              LegalCopyright: "Copyright Speck contributors. MIT licensed.",
            },
          },
        },
      },
    },
  };
  const resDir = path.join(root, "brand/windows");
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(
    path.join(resDir, command + ".json"),
    JSON.stringify(resource, null, 2) + "\n",
  );
}
const identityDir = path.join(root, "agent/internal/identity");
fs.mkdirSync(identityDir, { recursive: true });
fs.writeFileSync(
  path.join(identityDir, "brand.go"),
  `// Code generated by scripts/brand.mjs; DO NOT EDIT.\npackage identity\n\nconst Name = ${JSON.stringify(brand.name)}\nconst Tagline = ${JSON.stringify(brand.tagline)}\nconst Agent = \"Speck Agent\"\nconst Desktop = \"Speck Desktop Helper\"\nconst Description = \"Windows and Linux monitoring, remote access and recovery.\"\n`,
);
console.log(
  "Speck brand assets built: SVG, PNG, ICO, tokens and Windows metadata.",
);
