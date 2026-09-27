/** Only reusable inventory reads belong here. Secrets, sessions, live operations and
 * mutation preflights deliberately use the transport directly. Nothing is persisted. */
export function readPolicy(path: string): number | null {
  if (/^\/(keys(?:\/services|\/system-targets)?|ssh\/keys\?registration=false|context\/files)$/.test(path)) return 30000;
  if (/^\/unifi\/sites(?:\/[^/]+\/[^/]+\/(?:clients|devices(?:\/[^/?]+)?))?$/.test(path)) return 30000;
  if (/^\/infrastructure\/connections\/[^/]+\/resources\/[^/]+\/[^/]+\/metrics\?timeframe=(hour|day|week|month)$/.test(path)) return 30000;
  if (/^\/infrastructure\/connections\/[^/]+\/resources\/[^/]+\/[^/?]+\/explore$/.test(path)) return 30000;
  if (/^\/(schedules|patches|recovery\/(plans|runs))$/.test(path)) return 15000;
  if (/^\/(slide\/coverage|unifi\/equipment\/index)$/.test(path)) return 30000;
  if (/^\/fleet$/.test(path)) return 15000;
  if (/^\/(network\/map|infrastructure\/(inventory|connectors)|unifi\/(pool|status|clients|consoles)|slide\/(connection|restored-devices))$/.test(path)) return 30000;
  if (/^\/dns\/domains$/.test(path)) return 60000;
  if (/^\/slide\/inventory\?resource=(agent|device|snapshot|backup|network|restore(%2[fF]|\/)virt|restore(%2[fF]|\/)file|restore(%2[fF]|\/)image)$/.test(path)) return 30000;
  if (/^\/infrastructure\/connections\/[^/]+\/resources\/[^/]+\/[^/?]+$/.test(path)) return 30000;
  if (/^\/infrastructure\/connections\/[^/]+\/catalog(\?kind=[\w-]+)?$/.test(path)) return 300000;
  if (/^\/dns\/domains\/[^/]+\/records\?cached=true$/.test(path)) return 30000;
  return null;
}

type Entry = { value: any; at: number; revision: number };
type Pending = { promise: Promise<any>; controller: AbortController };

export function createReadCache(fetcher: (path: string, signal: AbortSignal) => Promise<any>, now = () => Date.now()) {
  const entries = new Map<string, Entry>(), pending = new Map<string, Pending>(), errors = new Set<string>();
  const listeners = new Set<() => void>();
  let generation = 0, revision = 0;
  const emit = () => listeners.forEach(fn => fn());
  const peek = (path: string) => {
    const entry = entries.get(path);
    return entry && now() - entry.at <= 300000 ? entry : undefined;
  };
  function refresh(path: string) {
    if (pending.has(path)) return pending.get(path)!.promise;
    const started = generation, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const promise = Promise.resolve().then(() => fetcher(path, controller.signal)).then(value => {
      if (controller.signal.aborted) throw new DOMException('Read invalidated', 'AbortError');
      if (started === generation) {
        const prior = entries.get(path);
        const changed = !prior || JSON.stringify(prior.value) !== JSON.stringify(value);
        entries.delete(path);
        entries.set(path, {value: structuredClone(value), at: now(), revision: changed ? ++revision : prior.revision});
        errors.delete(path);
        while (entries.size > 160) entries.delete(entries.keys().next().value!);
      }
      return value;
    }).catch(error => {
      if (started === generation) errors.add(path);
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      if (pending.get(path)?.promise === promise) pending.delete(path);
      emit();
    });
    pending.set(path, {promise, controller});
    emit();
    return promise;
  }
  function wait(promise: Promise<any>, signal?: AbortSignal): Promise<any> {
    if (!signal) return promise.then(value => structuredClone(value));
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, {once:true});
      promise.then(value => { if (!signal.aborted) resolve(structuredClone(value)); }, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }
  return {
    peek,
    state(path: string) { return {...entries.get(path), expired:!peek(path), pending:pending.has(path), failed:errors.has(path)}; },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    read(path: string, options: {signal?: AbortSignal; fresh?: boolean} = {}) {
      const started = generation;
      const valid = (value: any) => {
        if (started !== generation) throw new DOMException('Read invalidated', 'AbortError');
        return value;
      };
      const entry = peek(path);
      if (entry && !options.fresh) {
        if (now() - entry.at >= (readPolicy(path) ?? 0)) void refresh(path).catch(() => {});
        return wait(Promise.resolve(entry.value), options.signal).then(valid);
      }
      return wait(refresh(path), options.signal).then(valid);
    },
    invalidate(path: string) {
      pending.get(path)?.controller.abort();
      pending.delete(path); entries.delete(path); errors.delete(path); emit();
    },
    clear() {
      generation++;
      pending.forEach(p => p.controller.abort());
      pending.clear(); entries.clear(); errors.clear(); emit();
    },
  };
}
