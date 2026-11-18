import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { PlantStore } from './store.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const browserPages = new Set(['/', '/account', '/manager', '/admin']);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function serveFile(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const path = resolve(root, browserPages.has(pathname.replace(/\/$/, '') || '/') ? 'index.html' : `.${decodeURIComponent(pathname)}`);
  if (!path.startsWith(`${resolve(root)}${sep}`) || !mime[extname(path)]) {
    response.writeHead(404).end('Страница не найдена');
    return;
  }

  const info = await stat(path).catch((error) => {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return null;
  });
  if (!info?.isFile()) {
    response.writeHead(404).end('Страница не найдена');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mime[extname(path)],
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path).on('error', (error) => response.destroy(error)).pipe(response);
}

export async function createPlantServer({ store, development = false } = {}) {
  const api = createApi(store);
  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      if (pathname === '/api' || pathname.startsWith('/api/')) return await api(request, response, pathname);
      if (vite) return vite.middlewares(request, response);
      return await serveFile(request, response, pathname);
    } catch (error) {
      if (error instanceof URIError) return response.writeHead(400).end('Некорректный адрес');
      console.error(error);
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end('Ошибка сервера');
    }
  });
  let vite;
  if (development) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  }
  server.on('close', () => { void vite?.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const store = new PlantStore();
  try {
    const server = await createPlantServer({ store, development: process.argv.includes('--dev') });
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 4173);
    server.listen(port, host, () => {
      const address = server.address();
      console.log(`ФОРМА доступна по адресу http://${host}:${address.port}`);
    });
    server.on('error', (error) => {
      console.error(error.message);
      store.close();
      process.exit(1);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
    }
  } catch (error) {
    store.close();
    throw error;
  }
}
