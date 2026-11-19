// Serves the demo pages in demo/ at http://localhost:8417 (or $PORT), for trying Alter on
// a page with known problems. Alter only runs on http(s) pages, so file:// URLs won't do.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo');
const port = Number(process.env.PORT) || 8417;

http
  .createServer(async (req, res) => {
    const name = path.basename(new URL(req.url ?? '/', 'http://localhost').pathname) || 'broken-form.html';
    try {
      const body = await readFile(path.join(root, name.endsWith('.html') ? name : 'broken-form.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .on('error', (error) => {
    const inUse = /** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE';
    console.error(inUse ? `Port ${port} is already in use. Try: PORT=8418 npm run demo` : error);
    process.exit(1);
  })
  .listen(port, () => console.log(`Demo page: http://localhost:${port}/broken-form.html  (Ctrl+C to stop)`));
