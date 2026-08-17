#!/usr/bin/env node
// A tiny local server for interactive extension checks.
//
// The automated suite navigates to file://, but an unpacked extension does not
// receive file access by default. Serving the same fixture over loopback keeps
// the manual test representative without adding a package or a global tool.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = readFileSync(join(HERE, 'fixtures', 'report.html'));
const PORT = Number(process.env.RYKER_TEST_PORT || 8765);

const server = createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/report.html') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(REPORT);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Ryker fixture: http://127.0.0.1:' + PORT + '/report.html');
});
