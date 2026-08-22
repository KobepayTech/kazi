import type { DatabaseSync } from 'node:sqlite';
import { extname, normalize } from 'node:path';
import { newId } from '../domain/ids.ts';
import { AppError } from '../services/errors.ts';
import type { StoredFile, StoredFileBody, UploadStore } from '../services/uploads.ts';

const ALLOWED: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

// Cloudflare Durable Object SQLite rows are capped at 2 MB. Keeping each
// base64 chunk near 1 MB leaves ample room for row/key overhead.
const CHUNK_CHARS = 1_000_000;

const FILE_SCHEMA = `
CREATE TABLE IF NOT EXISTS hosted_uploads (
  path TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hosted_upload_chunks (
  path TEXT NOT NULL REFERENCES hosted_uploads(path) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  body_base64 TEXT NOT NULL,
  PRIMARY KEY (path, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_hosted_upload_chunks ON hosted_upload_chunks(path, chunk_index);
`;

type FileRow = {
  path: string;
  content_type: string;
  bytes: number;
  chunk_count: number;
};

type ChunkRow = { body_base64: string };

export class DurableUploadStore implements UploadStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly maxUploadBytes: number,
  ) {
    db.exec(FILE_SCHEMA);
  }

  save(filename: string, base64: string): StoredFile {
    const extension = extname(filename).toLowerCase();
    const contentType = ALLOWED[extension];
    if (contentType === undefined) {
      throw AppError.badRequest('unsupported_file', `Upload a ${Object.keys(ALLOWED).join(', ')} file.`);
    }

    const payload = base64.includes(',') ? (base64.split(',')[1] ?? '') : base64;
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) throw AppError.badRequest('empty_file', 'That file is empty.');
    if (buffer.length > this.maxUploadBytes) {
      throw AppError.badRequest(
        'file_too_large',
        `Files must be under ${Math.round(this.maxUploadBytes / 1_000_000)} MB.`,
      );
    }

    const canonicalBase64 = buffer.toString('base64');
    const chunks: string[] = [];
    for (let offset = 0; offset < canonicalBase64.length; offset += CHUNK_CHARS) {
      chunks.push(canonicalBase64.slice(offset, offset + CHUNK_CHARS));
    }

    const path = `/uploads/${newId('file')}${extension}`;
    this.db
      .prepare(
        'INSERT INTO hosted_uploads (path, content_type, bytes, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(path, contentType, buffer.length, chunks.length, new Date().toISOString());

    const insertChunk = this.db.prepare(
      'INSERT INTO hosted_upload_chunks (path, chunk_index, body_base64) VALUES (?, ?, ?)',
    );
    chunks.forEach((chunk, index) => insertChunk.run(path, index, chunk));

    return { path, bytes: buffer.length, contentType };
  }

  read(publicPath: string): StoredFileBody {
    const normalized = normalize(publicPath);
    if (!normalized.startsWith('/uploads/') || normalized.includes('..')) {
      throw AppError.notFound('File not found.');
    }

    const row = this.db
      .prepare('SELECT path, content_type, bytes, chunk_count FROM hosted_uploads WHERE path = ?')
      .get(normalized) as FileRow | undefined;
    if (row === undefined) throw AppError.notFound('File not found.');

    const chunks = this.db
      .prepare('SELECT body_base64 FROM hosted_upload_chunks WHERE path = ? ORDER BY chunk_index ASC')
      .all(normalized) as ChunkRow[];
    if (chunks.length !== Number(row.chunk_count)) throw AppError.notFound('File not found.');

    const body = Buffer.from(chunks.map((chunk) => String(chunk.body_base64)).join(''), 'base64');
    return { body, contentType: String(row.content_type) };
  }
}
