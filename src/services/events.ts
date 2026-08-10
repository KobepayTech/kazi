import type { RealtimeScope, StoredEvent, Store } from '../data/store.ts';

/** Every dashboard that is open right now belongs to one scope key. */
export const AGENCY_SCOPE_ID = 'soko-huru';

export type EventListener = (event: StoredEvent) => void;

function keyOf(scope: RealtimeScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

/**
 * Persist-then-notify event bus behind the live dashboards.
 *
 * Events are written to the database first and delivered to in-process
 * listeners second, so a dashboard that reconnects can replay everything it
 * missed with `since` rather than showing a stale page.
 */
export class EventBus {
  private readonly store: Store;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(store: Store) {
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

  subscriberCount(scope: RealtimeScope, scopeId: string): number {
    return this.listeners.get(keyOf(scope, scopeId))?.size ?? 0;
  }
}
