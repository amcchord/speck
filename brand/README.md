# Speck identity

![Speck](assets/speck-wordmark-forest.svg)

**A LITTLE LIGHTWEIGHT RMM**

Speck should feel calm, small and useful. Give the operator a clear view of the
machine and a clear next action. Keep the interface free of marketing copy.
The tagline above is the only product slogan.

## Name and mark

Write **Speck** in prose and **Speck RMM** when the category needs clarification.
The logo is lowercase **speck**. Components are **Speck Agent**, **Speck Desktop
Helper**, and **Speck** for the web console. Technical identifiers such as
`SpeckAgent`, `speck-agent`, existing service paths, and enrollment IDs stay stable.

The mark is eight rounded rays around one small point. It keeps the original
asterisk character while rendering consistently on Windows, Linux and the web.
Use the supplied paths; do not substitute a Unicode asterisk, emoji or font icon.
The wordmark is an outlined Inter drawing, so installed fonts cannot change it.

- Preferred: lime on forest, forest on paper or white.
- Single color: supplied white or black variants.
- App icon: lime mark in the forest rounded square.
- Clear space: at least one quarter of the mark's width on every side.
- Minimum: standalone mark 16px; wordmark 112px wide. App icons have dedicated
  16, 24, 32, 48, 64, 128 and 256px exports.
- Preserve proportions. No shadows, gradients, glow, outlines or added words
  inside the logo. Keep the mark still; it is not a loading spinner.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| Forest | `#192E24` | Navigation, sign-in brand panel, app icon |
| Fern | `#385D44` | Primary actions, focus, links |
| Lime | `#DCECAB` | Identity on forest, restrained highlights |
| Paper | `#F4F5F0` | Page background |
| White | `#FFFFFF` | Working surfaces and fields |
| Ink | `#24382C` | Primary text |
| Muted | `#5E6F61` | Supporting text on paper/white |
| Line | `#DCE3D8` | Quiet separators; never the only focus signal |
| Success | `#35613F` | Positive status text |
| Warning | `#795916` | Review and attention text |
| Danger | `#993E32` | Failed or error status text |

Status always has a word, never color alone. Lime is a surface/accent, not small
text on white. Use a visible two-pixel focus ring, lime on forest or fern on light
surfaces. Disabled controls may be subdued; active text must remain readable.

## Type and layout

The console bundles Inter 4.1 locally. No font CDN or external font request.
Use regular 400 for body copy, medium 550 for headings, and semibold 600–650 for
labels/actions. Use the platform monospace font for commands, paths and evidence.
Native terminal installers inherit the user's terminal font and color preferences.

| Element | Size |
| --- | --- |
| Page heading | 36px desktop / 28px compact |
| Section heading | 20–23px |
| Field and action text | 13px |
| Supporting text / table body | 12px |
| Compact metadata | 11px; avoid going smaller in working views |
| Brand caption | 10px, uppercase, widely tracked |

Use a 4px spacing rhythm with 16–28px panel padding. Cards use 10–12px corners;
controls 6–7px. Use borders for grouping and shadows only for overlays.
Navigation has consistent 19px stroke icons, not unrelated symbol glyphs.
Keep the working area light, with one persistent dark navigation surface.

At narrow widths, navigation stays labeled, sign-out remains available, device
cards scroll horizontally, tabs scroll independently, and forms become one column.
Tables may scroll inside their own region; the page itself must not overflow.

## Voice

Use short, specific labels: **Add a device**, **Run command**, **Verify restored
machines**, **Stop restored VMs**. State the result: **Online**, **Matched**,
**No matching devices**. Explain a constraint only where it changes an action.
Keep credentials out of confirmations, errors, screenshots and examples.

Installer copy follows three steps: **Download and verify**, **Install and
enroll**, **Start Speck Agent**. End with the actual service state and one useful
next step. An installer must never print an enrollment token.

## Across the product

| Surface | Identity application |
| --- | --- |
| Web | Shared token CSS, outlined wordmark, bundled Inter, SVG navigation, favicon and touch icon |
| Windows agent | Embedded multi-size icon, File Description, Product Name, version and tagline; service display name/description |
| Windows desktop helper | Same embedded identity; remains an unprivileged background process |
| Windows installer | Minimal terminal header, three steps, clear completion; `-About` describes it without installing |
| Linux agent | Branded help/version/errors and systemd description |
| Linux installer | Same header/steps; installs the shared icon and desktop helper metadata; `--about` is non-mutating |
| GitHub | Wordmark, actual console screenshots, brand guide and documented verification |

Agents intentionally have no splash screen, tray or foreground window. Their
visible identity belongs in file properties, service tools, installer output and
help. Branding does not change privileges, connection policy or service names.

## Files and maintenance

- [identity.json](identity.json): names, tagline and palette.
- [assets/](assets/): reusable SVG, PNG and ICO exports, including monochrome.
- [tokens.css](tokens.css): generated CSS custom properties.
- [wordmark-path.svg](wordmark-path.svg): canonical outlined lettering.
- [fonts/](fonts/): bundled Inter and its OFL license.
- [windows/](windows/): generated resource definitions for both executables.
- [index.html](index.html): visual brand sheet; view with the local preview server.
- [UI review](../docs/ui-review.md) and [screenshot gallery](../docs/screenshots/README.md).

Run `node scripts/brand.mjs` from the repository root after `npm --prefix web ci`.
It regenerates the exports, tokens, Go identity constants, Windows resource
configuration and web copies. The web build runs it automatically; the full build
also compiles the Windows resource objects. Generated web copies and object files
are ignored. Commit the canonical assets and source together.

When changing the identity, update the guide, installer strings and screenshots in
the same change. Preserve the single tagline and the no-filler rule. Font updates
must retain the license and regenerate the outlined wordmark intentionally.
