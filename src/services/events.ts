import type { RealtimeScope, StoredEvent, TenantStore } from '../data/store.ts';

/** The agency dashboard's scope id within a tenant. */
export const AGENCY_SCOPE_ID = 'agency';

export type EventListener = (event: StoredEvent) => void;

function keyOf(scope: RealtimeScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

/**
 * Persist-then-notify bus behind the live pages, one per tenant.
 *
 * Events are written to the database first and pushed to open connections
 * second, so a dashboard that reconnects replays what it missed instead of
 * showing a stale page.
 */
export class EventBus {
  private readonly store: TenantStore;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(store: TenantStore) {
    this.store = store;
  }

  publish(scope: RealtimeScope, scopeId: string, type: string, payload: unknown): StoredEvent {
    const event = this.store.appendEvent(scope, scopeId, type, payload);
    for (const listener of this.listeners.get(keyOf(scope, scopeId)) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken dashboard connection must never fail the swipe that caused it.
      }
    }
    return event;
  }

  subscribe(scope: RealtimeScope, scopeId: string, listener: EventListener): () => void {
    const key = keyOf(scope, scopeId);
    const set = this.listeners.get(key) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  replay(scope: RealtimeScope, scopeId: string, sinceId: number): StoredEvent[] {
    return this.store.listEventsSince(scope, scopeId, sinceId);
  }
}
