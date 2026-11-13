import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApi } from './api.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createServer(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const db = openDb(cfg.dbPath);
  const api = createApi(db, cfg);
  const gzipCache = new Map();

  const manifest = JSON.stringify({
    name: cfg.appName,
    short_name: cfg.appName.slice(0, 12),
    description: `Doorstep scrap pickup in ${cfg.city}`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f4',
    theme_color: '#1b7f3b',
    lang: 'en-IN',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });

  function sendBuffer(req, res, buf, type, key, extra = {}) {
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
    const compressible = /^(text|application\/(json|manifest))/.test(type);
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      if (!gzipCache.has(key)) gzipCache.set(key, zlib.gzipSync(buf));
      buf = gzipCache.get(key);
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    }
    headers['Content-Length'] = buf.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    if (url.pathname === '/manifest.webmanifest')
      return sendBuffer(req, res, Buffer.from(manifest), 'application/manifest+json', 'manifest');

    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      rel = '/';
    }
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    let buf = fs.readFileSync(file);
    if (rel === '/index.html')
      buf = Buffer.from(buf.toString('utf8').replaceAll('{{APP_NAME}}', escapeHtml(cfg.appName)));
    sendBuffer(req, res, buf, MIME[path.extname(file)] || 'application/octet-stream', file + etag, {
      ETag: etag,
    });
  }

  const server = http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    serveStatic(req, res, url);
  });

  return { server, db, cfg };
}

export function start() {
  if (config.production && config.otpMode === 'test' && !config.allowTestOtpInProduction) {
    console.error(
      'Refusing to start: NODE_ENV=production with OTP_MODE=test would let anyone log in as any user.\n' +
        'Set OTP_MODE=sms (see server/sms.js), or ALLOW_TEST_OTP=1 for a private trial.'
    );
    process.exit(1);
  }
  const { server, db, cfg } = createServer();
  for (const mobile of cfg.adminMobiles) {
    db.prepare(
      `INSERT INTO users (mobile, name, role, status, created_at) VALUES (?, 'Admin', 'admin', 'approved', ?)
       ON CONFLICT(mobile) DO UPDATE SET role = 'admin', status = 'approved'`
    ).run(mobile, new Date().toISOString());
  }
  server.listen(cfg.port, () => {
    console.log(`${cfg.appName} is running on port ${cfg.port}`);
    if (cfg.otpMode === 'test')
      console.log('TEST MODE: every mobile number logs in with the same test OTP. Do not use for real customers.');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
