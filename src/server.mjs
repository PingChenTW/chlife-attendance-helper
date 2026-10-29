import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { AppError, ensure } from './errors.mjs';
import { AttendanceService } from './service.mjs';
import { DemoAdapter } from './demo.mjs';
import { ChlifeAdapter } from './upstream.mjs';
import { ReportService, configuredReportSources } from './reports.mjs';
import { configuredGroups } from './group-links.mjs';
import { groupManifest } from '../public/group-context.js';

const PUBLIC = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
export function createApp({ service, reports = new ReportService(configuredReportSources(service.adapter)), groups = new Map(), defaultGroup = null, allowedOrigins = [], apiBase = '' }) {
  const limits = new Map();
  const connectOrigin = apiBase ? new URL(apiBase).origin : '';
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${connectOrigin}; base-uri 'self'; frame-ancestors 'none'; form-action 'none'`);
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        // Host is used only to compare a same-origin request, never to construct upstream URLs.
        const sameOrigin = origin && (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`);
        ensure(!origin || sameOrigin || allowedOrigins.includes(origin), 403, 'ORIGIN_NOT_ALLOWED', '此網頁來源尚未開放連接。');
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Attendance-Client', 'Access-Control-Max-Age': '600' }); res.end(); return;
        }
        const key = req.socket.remoteAddress;
        const now = Date.now();
        for (const [ip, entry] of limits) if (entry.reset < now) limits.delete(ip);
        ensure(limits.size < 10000 || limits.has(key), 429, 'BUSY', '目前使用人數較多，請稍後再試。');
        const counter = limits.get(key) ?? { read: 0, write: 0, reset: now + 60000 };
        const kind = req.method === 'POST' ? 'write' : 'read';
        counter[kind]++; limits.set(key, counter);
        if (counter[kind] > (kind === 'write' ? 15 : 120)) { res.setHeader('Retry-After', String(Math.ceil((counter.reset - now) / 1000))); throw new AppError(429, 'RATE_LIMIT', '操作較頻繁，請稍後再試。'); }
        let apiPath=url.pathname,activeService=service,activeReports=reports;
        if(apiPath.startsWith('/api/groups/')) {
          const match=apiPath.match(/^\/api\/groups\/([1-8])\/(.+)$/);
          ensure(match,400,'GROUP_LINK','大組連結無效，請使用管理者提供的完整網址。');
          const entry=groups.get(match[1]);
          ensure(entry,503,'GROUP_NOT_CONFIGURED','這個大組專屬入口尚未啟用，請聯絡管理者。');
          activeService=entry.service;activeReports=entry.reports;apiPath='/api/'+match[2];
        }
        if (apiPath === '/api/meta' && req.method === 'GET') { json(200, await activeService.metadata()); return; }
        if (apiPath === '/api/reports/meta' && req.method === 'GET') { json(200,activeReports.metadata()); return; }
        if (apiPath === '/api/reports/summary' && req.method === 'GET') { json(200,await activeReports.summary({week:url.searchParams.get('week')}));return; }
        if (apiPath === '/api/reports/weekly' && req.method === 'GET') {
          json(200,await activeReports.weekly({ week:url.searchParams.get('week'),source:url.searchParams.get('source') ?? 'primary',group:url.searchParams.get('group') })); return;
        }
        if (apiPath === '/api/roster' && req.method === 'GET') {
          json(200, await activeService.roster({ week: url.searchParams.get('week'), scope: url.searchParams.get('scope'), meeting: url.searchParams.get('meeting'), audience: url.searchParams.get('audience') ?? 'all' })); return;
        }
        if (apiPath === '/api/attendance' && req.method === 'POST') {
          ensure(req.headers['content-type']?.split(';')[0].trim() === 'application/json' && req.headers['x-attendance-client'] === '1', 415, 'JSON_REQUIRED', '請使用點名工具送出資料。');
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; ensure(size <= 262144, 413, 'TOO_LARGE', '送出的資料過多，請分批處理。'); chunks.push(chunk); }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400, 'BAD_JSON', '送出資料格式錯誤。'); }
          ensure(input && typeof input === 'object' && !Array.isArray(input), 400, 'BAD_JSON', '送出資料格式錯誤。');
          json(200, await activeService.submit(input)); return;
        }
        throw new AppError(404, 'NOT_FOUND', '找不到此功能。');
      }
      ensure(req.method === 'GET' || req.method === 'HEAD', 405, 'METHOD_NOT_ALLOWED', '不支援此操作。');
      if (url.pathname === '/health') { json(200, { ok: true, mode: service.adapter.mode, writesEnabled: service.allowWrites }); return; }
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      ensure(!pathname.includes('\\') && !pathname.includes('\0'), 404, 'NOT_FOUND', '找不到此頁面。');
      const target = path.resolve(PUBLIC, '.' + pathname);
      ensure(target.startsWith(PUBLIC + path.sep) && types[path.extname(target)], 404, 'NOT_FOUND', '找不到此頁面。');
      let content;
      if (pathname === '/config.js') content = Buffer.from(`window.ATTENDANCE_CONFIG = ${JSON.stringify({ apiBase, defaultGroup })};\n`);
      else if (/^\/manifest-group-[1-8]\.webmanifest$/.test(pathname)) content=Buffer.from(JSON.stringify(groupManifest(JSON.parse(await readFile(path.join(PUBLIC,'manifest.webmanifest'),'utf8')),pathname.match(/group-([1-8])/)[1])));
      else { try { content = await readFile(target); } catch { throw new AppError(404, 'NOT_FOUND', '找不到此頁面。'); } }
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(error instanceof AppError ? error.status : 500, { error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '暫時無法完成操作，請稍後再試。' } });
      else res.end();
    }
  });
}

export function configuredRuntime(env = {}, { mode = env.APP_MODE ?? 'demo', now, adapterFactory } = {}) {
  ensure(['live', 'demo'].includes(mode), 500, 'CONFIG', 'APP_MODE must be live or demo');
  const options = { allowWrites: mode === 'demo' || env.ALLOW_WRITES === 'true', ...(env.SNAPSHOT_SECRET ? { secret: env.SNAPSHOT_SECRET } : {}), ...(now ? { now } : {}) };
  const groups = configuredGroups(env.GROUP_LINKS_JSON, { ...options, ...(adapterFactory ? { adapterFactory } : {}) });
  const defaultGroup = env.DEFAULT_GROUP ?? null;
  if (defaultGroup !== null) {
    ensure(typeof defaultGroup === 'string' && /^[1-8]$/.test(defaultGroup) && groups.has(defaultGroup), 500, 'DEFAULT_GROUP', '預設大組入口尚未設定，請管理者檢查。');
    // Reuse the same account, signing scope and queue; no separate legacy login is created.
    return { ...groups.get(defaultGroup), groups, defaultGroup };
  }
  const adapter = mode === 'demo' ? new DemoAdapter() : new ChlifeAdapter({ churchId: Number(env.CHLIFE_CHURCH_ID), account: env.CHLIFE_ACCOUNT, password: env.CHLIFE_PASSWORD, deviceToken: env.CHLIFE_DEVICE_TOKEN });
  const service = new AttendanceService(adapter, options);
  const reports = new ReportService(configuredReportSources(adapter, env.REPORT_ACCOUNTS_JSON));
  return { service, reports, groups, defaultGroup };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv.includes('--demo') ? 'demo' : (process.env.APP_MODE ?? 'demo');
  const runtime = configuredRuntime(process.env, { mode });
  const server = createApp({ ...runtime, allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean) });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  const port = Number(process.env.PORT ?? 4173), host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => console.log(`Attendance helper: http://${host}:${port} (${mode}, writes ${runtime.service.allowWrites ? 'enabled' : 'disabled'})`));
  process.on('SIGTERM', () => server.close());
}
