import { createServer as createHttpServer, type Server } from 'node:http';
import type { Platform } from '../app.ts';
import { createRouter } from './routes.ts';

export function createServer(platform: Platform): Server {
  const router = createRouter(platform);
  const server = createHttpServer((req, res) => {
    void router.handle(req, res);
  });
  // The live pages hold their connection open; the default idle timeout would
  // cut the event stream.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  return server;
}

export function startServer(platform: Platform): Promise<Server> {
  const server = createServer(platform);
  return new Promise((resolve) => {
    server.listen(platform.config.port, () => resolve(server));
  });
}
