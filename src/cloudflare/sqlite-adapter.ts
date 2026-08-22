import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from '../data/db.ts';

type Row = Record<string, unknown>;

type SqlCursor<T extends Row = Row> = {
  next(): IteratorResult<T>;
  toArray(): T[];
  rowsWritten: number;
};

type SqlStorage = {
  exec<T extends Row = Row>(query: string, ...bindings: unknown[]): SqlCursor<T>;
};

type DurableStorage = {
  sql: SqlStorage;
};

function consume(cursor: SqlCursor): void {
  cursor.toArray();
}

/**
 * Small compatibility layer for the subset of node:sqlite used by Kazi.
 * Durable Object SQL is synchronous, so Store and TenantStore can stay sync.
 * Cloudflare coalesces consecutive storage writes in one event atomically.
 */
export function createDurableDatabase(storage: DurableStorage): DatabaseSync {
  storage.sql.exec('PRAGMA foreign_keys = ON;').toArray();
  storage.sql.exec(SCHEMA).toArray();

  const database = {
    exec(sql: string): void {
      const command = sql.trim().toUpperCase();
      // node:sqlite uses explicit transactions. Durable Object SQLite rejects
      // BEGIN/COMMIT/ROLLBACK and instead atomically coalesces synchronous SQL
      // writes in the same event, which is exactly how Kazi's transactions run.
      if (
        command.startsWith('BEGIN') ||
        command.startsWith('COMMIT') ||
        command.startsWith('ROLLBACK') ||
        command.startsWith('PRAGMA JOURNAL_MODE') ||
        command.startsWith('PRAGMA BUSY_TIMEOUT')
      ) {
        return;
      }
      consume(storage.sql.exec(sql));
    },

    prepare(sql: string) {
      return {
        get(...bindings: unknown[]): Row | undefined {
          const item = storage.sql.exec(sql, ...bindings).next();
          return item.done ? undefined : item.value;
        },
        all(...bindings: unknown[]): Row[] {
          return storage.sql.exec(sql, ...bindings).toArray();
        },
        run(...bindings: unknown[]) {
          const cursor = storage.sql.exec(sql, ...bindings);
          cursor.toArray();
          return { changes: BigInt(cursor.rowsWritten), lastInsertRowid: 0n };
        },
      };
    },

    close(): void {
      // Durable Object storage lifecycle is managed by Cloudflare.
    },
  };

  return database as unknown as DatabaseSync;
}
