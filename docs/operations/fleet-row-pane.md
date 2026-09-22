# Fleet row and machine pane

Click ordinary content or blank space in a machine row to open its details.
Checkboxes and screen/terminal buttons retain their individual actions, and
selecting text does not open a pane. The machine-name button remains keyboard
accessible and reports whether its details are expanded.

The pane is non-modal: the fleet stays readable and other visible rows can be
selected directly. A green row fill and left accent identify the open machine,
independently of bulk checkbox selection. Close or Escape dismisses the pane and
returns focus to its machine. Escape in a nested modal dismisses that modal first.
Navigation and sign-out clear the pane. Replacement removes the old detail tree
synchronously, preventing duplicate IDs and stale data targeting a different pane.

The entrance is a 180 ms, 24-pixel ease-out slide with a small opacity change.
There is no backdrop or blur. Reduced-motion settings disable animation. On mobile,
the pane fills the screen and the underlying fleet cannot scroll; dismissing it
restores normal scrolling. Pane overscroll does not scroll the table behind it.

## Verification

TypeScript/Vite and the 24 existing web tests pass. Chromium UI review at desktop
and 390-pixel mobile width verified CPU-cell and blank-row activation, direct
machine switching, independent bulk selection, quick PowerShell tab selection,
keyboard Enter/Escape, nested modal dismissal, active-row cleanup and navigation.
Computed styles confirmed 180 ms animation, non-modal state and no backdrop filter;
mobile pane width matches the viewport without horizontal overflow. The final
keyboard check returned focus to the originating machine. No remote connection,
command, device write or recovery action was run by these UI checks.

The [public screenshots](../screenshots/fleet-row-pane/README.md) contain synthetic
data. This change is served by the web console and Desktop's hosted interface;
no new native installer or endpoint-agent binary is required.
