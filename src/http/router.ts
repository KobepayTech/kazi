import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../services/errors.ts';

/** Returned by a handler that has already written the response itself. */
export const HANDLED = Symbol('handled');

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
};

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

type Route = { method: string; segments: string[]; handler: Handler };

// Poster images and certificate scans arrive as base64 in the JSON body.
const MAX_BODY_BYTES = 8_000_000;

export function json(res: ServerResponse, status: number, payload: unknown): typeof HANDLED {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
  return HANDLED;
}

export function html(res: ServerResponse, status: number, markup: string): typeof HANDLED {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(markup),
  });
  res.end(markup);
  return HANDLED;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw AppError.badRequest('body_too_large', 'Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    throw AppError.badRequest('invalid_json', 'Request body must be valid JSON.');
  }
}

function split(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method: method.toUpperCase(), segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.add('PATCH', pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler);
  }

  private match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = split(path);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const expected = route.segments[index] ?? '';
        const actual = parts[index] ?? '';
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      const route = this.match(req.method ?? 'GET', url.pathname);
      if (route === null) {
        json(res, 404, { error: { code: 'not_found', message: `No route for ${req.method} ${url.pathname}` } });
        return;
      }
      const body = await readBody(req);
      const result = await route.handler({ req, res, url, params: route.params, query: url.searchParams, body });
      if (result === HANDLED || res.writableEnded) return;
      json(res, 200, result ?? {});
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof AppError) {
        json(res, error.status, { error: { code: error.code, message: error.message, details: error.details } });
        return;
      }
      console.error('[kobeos] unhandled error', error);
      json(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
    }
  }
}
