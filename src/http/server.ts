import { createServer as createHttpServer, type Server } from 'node:http';
import type { Kobeos } from '../app.ts';
import { createRouter } from './routes.ts';

export function createServer(app: Kobeos): Server {
  const router = createRouter(app);
  const server = createHttpServer((req, res) => {
    void router.handle(req, res);
  });
  // Live dashboards hold their connection open; the default 5s idle timeout
  // would cut the event stream.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  return server;
}

export function startServer(app: Kobeos): Promise<Server> {
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(app.config.port, () => resolve(server));
  });
}
