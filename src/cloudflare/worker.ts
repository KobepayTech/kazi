import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createPlatform, type Platform } from '../app.ts';
import { createServer } from '../http/server.ts';
import { createDurableDatabase } from './sqlite-adapter.ts';
import { DurableUploadStore } from './uploads.ts';

type Env = {
  KAZI_APP: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
  ASSETS: { fetch(request: Request): Promise<Response> };
  KOBEOS_TENANT_KEY?: string;
  KOBEOS_PUBLIC_URL?: string;
  KOBEOS_TENANT_NAME?: string;
  KOBEOS_TENANT_SLUG?: string;
};

function pageAsset(pathname: string): string | null {
  if (pathname === '/') return '/index.html';
  if (pathname === '/jobs') return '/swipe.html';
  if (pathname === '/admin') return '/agency.html';
  if (/^\/e\/[^/]+$/.test(pathname)) return '/employer.html';
  return null;
}

export class KaziApp extends DurableObject<Env> {
  private readonly platform: Platform;
  private readonly nodeHandler: ReturnType<typeof httpServerHandler>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    if (!env.KOBEOS_TENANT_KEY) {
      throw new Error('KOBEOS_TENANT_KEY is required for the hosted Kazi runtime.');
    }

    const database = createDurableDatabase(ctx.storage);
    const config = {
      databasePath: ':memory:',
      uploadsDir: '/tmp/kazi-uploads',
      publicBaseUrl: env.KOBEOS_PUBLIC_URL ?? 'https://jobs.kobeos.app',
      defaultTenantName: env.KOBEOS_TENANT_NAME ?? 'Soko Huru',
      defaultTenantSlug: env.KOBEOS_TENANT_SLUG ?? 'soko-huru',
      defaultTenantApiKey: env.KOBEOS_TENANT_KEY,
    };
    const uploads = new DurableUploadStore(database, 5_000_000);
    this.platform = createPlatform({ config, database, uploads });
    this.nodeHandler = httpServerHandler(createServer(this.platform));
  }

  async fetch(request: Request): Promise<Response> {
    return this.nodeHandler.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const asset = pageAsset(url.pathname);
    if (asset !== null && (request.method === 'GET' || request.method === 'HEAD')) {
      const assetUrl = new URL(asset, request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    if (!env.KOBEOS_TENANT_KEY) {
      return Response.json(
        { error: { code: 'configuration_error', message: 'Kazi hosted runtime is not fully configured.' } },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    const app = env.KAZI_APP.getByName('platform-v1');
    return app.fetch(request);
  },
};
