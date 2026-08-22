import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import type { AppConfig } from '../config.ts';
import { newId } from '../domain/ids.ts';
import { AppError } from './errors.ts';

const ALLOWED: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export type StoredFile = { path: string; bytes: number; contentType: string };
export type StoredFileBody = { body: Buffer; contentType: string };

/** Storage contract shared by the local disk and Cloudflare implementations. */
export interface UploadStore {
  save(filename: string, base64: string): StoredFile;
  read(publicPath: string): StoredFileBody;
}

/**
 * Poster images, applicant photos and certificate scans. The local runtime
 * stores files on disk. Hosted runtimes can inject another UploadStore without
 * changing the route or service layers.
 */
export class UploadService implements UploadStore {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    mkdirSync(config.uploadsDir, { recursive: true });
  }

  /** Accepts a base64 payload from the console and returns its public path. */
  save(filename: string, base64: string): StoredFile {
    const extension = extname(filename).toLowerCase();
    const contentType = ALLOWED[extension];
    if (contentType === undefined) {
      throw AppError.badRequest('unsupported_file', `Upload a ${Object.keys(ALLOWED).join(', ')} file.`);
    }
    const payload = base64.includes(',') ? (base64.split(',')[1] ?? '') : base64;
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) throw AppError.badRequest('empty_file', 'That file is empty.');
    if (buffer.length > this.config.maxUploadBytes) {
      throw AppError.badRequest(
        'file_too_large',
        `Files must be under ${Math.round(this.config.maxUploadBytes / 1_000_000)} MB.`,
      );
    }

    const name = `${newId('file')}${extension}`;
    writeFileSync(join(this.config.uploadsDir, name), buffer);
    return { path: `/uploads/${name}`, bytes: buffer.length, contentType };
  }

  /** Reads a stored file back, refusing anything that escapes the upload directory. */
  read(publicPath: string): StoredFileBody {
    const name = normalize(publicPath.replace(/^\/uploads\//, ''));
    if (name.includes('/') || name.includes('..') || name.length === 0) {
      throw AppError.notFound('File not found.');
    }
    const contentType = ALLOWED[extname(name).toLowerCase()];
    if (contentType === undefined) throw AppError.notFound('File not found.');
    try {
      return { body: readFileSync(join(this.config.uploadsDir, name)), contentType };
    } catch {
      throw AppError.notFound('File not found.');
    }
  }
}
