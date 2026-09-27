import { bindResourceNavigation } from "./resource-navigation";
import './resource-detail.css';
type Options = { className?: string; tone?: string; subtitle?: string };

/** One resource inspector, with the list still available beside it. Action forms
 * use the existing modal review flow above the inspector. */
export function createFlyout(dialog: (title: string, html: string, options?: any) => HTMLDialogElement) {
  let active: HTMLDialogElement | null = null;
  let originalOpener: HTMLElement | null = null;
  let pointerTarget: HTMLElement | null = null, pointerAt = 0;
  // Safari does not focus buttons on pointer click, so activeElement alone loses
  // the return target. Keyboard activation continues to use the focused element.
  document.addEventListener('pointerdown', event => {
    pointerTarget = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,[role="button"]') : null;
    pointerAt = performance.now();
  }, true);
  return (title: string, html: string, options: Options = {}) => {
    const candidate = pointerTarget?.isConnected && performance.now()-pointerAt<1000 ? pointerTarget : document.activeElement as HTMLElement | null;
    const opener = active?.contains(candidate) ? originalOpener : candidate;
    active?.close(); active?.remove();
    const pane = dialog(title, `<div class="resource-body">${html}</div>`, {className:`device-drawer resource-flyout ${options.className || ''}`,modal:false});
    bindResourceNavigation(pane);
    active = pane;
    originalOpener = opener;
    pane.dataset.tone = options.tone || 'compute';
    pane.dataset.detailFlyout = '';
    if (options.subtitle) {
      const subtitle = document.createElement('span');
      subtitle.className = 'resource-subtitle'; subtitle.textContent = options.subtitle;
      pane.querySelector('.dialog-head h2')!.append(subtitle);
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || active !== pane || !pane.open || document.querySelector('dialog:modal')) return;
      event.preventDefault(); event.stopImmediatePropagation(); pane.close();
    };
    document.addEventListener('keydown', escape, true);
    pane.addEventListener('close', () => {
      document.removeEventListener('keydown', escape, true);
      if (active !== pane) return;
      active = null;
      if (opener?.isConnected && !document.querySelector('dialog:modal')) opener.focus({preventScroll:true});
    });
    pane.querySelector<HTMLButtonElement>('.close')?.focus({preventScroll:true});
    return pane;
  };
}
