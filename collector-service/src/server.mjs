import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAds } from './collector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 8787);
const maxTarget = Number(process.env.MAX_TARGET || 1000);
const defaultDelayMs = Number(process.env.COLLECTOR_DELAY_MS || 850);
const defaultStableRounds = Number(process.env.COLLECTOR_STABLE_ROUNDS || 12);
const defaultHeadless = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const defaultWorkerMode = String(process.env.WORKER_MODE || 'local_chrome');
const defaultEngine = String(process.env.COLLECTOR_ENGINE || 'network_first');
const defaultNetworkDelayMs = Number(process.env.NETWORK_DELAY_MS || 220);
const defaultWarmupAttempts = Number(process.env.WARMUP_ATTEMPTS || 4);

await fs.mkdir(dataDir, { recursive: true });
const jobs = new Map();

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    created_at: job.createdAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    input: job.input,
    progress: job.progress,
    error: job.error
  };
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function emit(job) {
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const response of job.listeners) response.write(payload);
}

async function persist(job) {
  if (job.result) await fs.writeFile(path.join(dataDir, `${job.id}.json`), JSON.stringify(job.result, null, 2));
}

async function runJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  emit(job);
  try {
    job.result = await collectAds(job.input, {
      signal: job.controller.signal,
      onProgress(progress) {
        job.progress = { ...job.progress, ...progress, updated_at: new Date().toISOString() };
        emit(job);
      }
    });
    job.status = 'finished';
    job.finishedAt = new Date().toISOString();
    await persist(job);
  } catch (error) {
    job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
    job.finishedAt = new Date().toISOString();
    job.error = error?.message || String(error);
  }
  emit(job);
}

async function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(publicDir, rel);
  if (!full.startsWith(publicDir)) return false;
  try {
    const body = await fs.readFile(full);
    const type = full.endsWith('.html') ? 'text/html; charset=utf-8' : full.endsWith('.js') ? 'application/javascript; charset=utf-8' : full.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
    res.end(body);
    return true;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'pt-glory-collector-service-prototype', version: '0.2.14', maxTarget, defaultWorkerMode, defaultEngine });
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readJson(req);
      const keyword = String(body.keyword || '').trim();
      if (!keyword) return sendJson(res, 400, { error: 'keyword_required' });
      const target = Math.max(1, Math.min(Number(body.target) || 100, maxTarget));
      const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job = {
        id,
        status: 'queued',
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        input: {
          keyword,
          country: String(body.country || 'TH').toUpperCase(),
          status: String(body.status || 'active'),
          mediaType: String(body.mediaType || 'all'),
          target,
          delayMs: defaultDelayMs,
          stableRounds: defaultStableRounds,
          headless: body.headless == null ? defaultHeadless : !!body.headless,
          workerMode: ['local_chrome','bundled_chromium'].includes(String(body.workerMode)) ? String(body.workerMode) : defaultWorkerMode,
          engine: ['network_first','dom_only'].includes(String(body.engine)) ? String(body.engine) : defaultEngine,
          networkDelayMs: defaultNetworkDelayMs,
          warmupAttempts: defaultWarmupAttempts
        },
        progress: { state: 'queued', count: 0, target },
        result: null,
        error: null,
        controller: new AbortController(),
        listeners: new Set()
      };
      jobs.set(id, job);
      runJob(job);
      return sendJson(res, 202, publicJob(job));
    }

    if (parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
      const job = jobs.get(parts[2]);
      if (!job) return sendJson(res, 404, { error: 'job_not_found' });

      if (req.method === 'GET' && parts.length === 3) return sendJson(res, 200, publicJob(job));

      if (req.method === 'GET' && parts[3] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        job.listeners.add(res);
        res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
        req.on('close', () => job.listeners.delete(res));
        return;
      }

      if (req.method === 'GET' && parts[3] === 'export') {
        if (!job.result) return sendJson(res, 409, { error: 'result_not_ready', status: job.status });
        const body = JSON.stringify(job.result, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="pt-glory-meta-ads-${job.id}.json"`,
          'Content-Length': Buffer.byteLength(body)
        });
        return res.end(body);
      }

      if (req.method === 'DELETE' && parts.length === 3) {
        job.controller.abort();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && await serveStatic(url.pathname, res)) return;
    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(port, () => console.log(`PT Glory Collector Service: http://localhost:${port}`));
