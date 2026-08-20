/**
 * STT benchmark harness - local only.
 *
 *   node server.mjs            -> http://localhost:5055
 *
 * Zero npm dependencies: node:http + node:fs, and global fetch/FormData/Blob
 * from Node 18+. Nothing here is wired into the production app; it reads the
 * same env vars so it measures what production would actually get.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROVIDERS, providerStatus, getProvider, LANGUAGE_PRESETS } from "./lib/providers.mjs";
import { scoreRun, diffTokens } from "./lib/metrics.mjs";
import {
  AUDIO_DIR, listClips, getClip, readClipBuffer, addClip, updateClip,
  deleteClip, saveRun, loadLatestRun, listRuns, loadRun,
} from "./lib/store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const PORT = Number(process.env.STT_BENCH_PORT || 5055);

/* ------------------------------------------------------------------ *
 * .env loading (no dotenv dependency)
 * ------------------------------------------------------------------ */

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return 0;
  let n = 0;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) { process.env[key] = val; n++; }
  }
  return n;
}

// stt-benchmark/.env wins; the backend's own .env fills in anything missing,
// so Azure/OpenAI keys already configured for the API are picked up for free.
const envLoaded =
  loadEnvFile(path.join(HERE, ".env")) + loadEnvFile(path.join(HERE, "..", ".env"));

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

const MAX_BODY = 60 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error(`Body over ${MAX_BODY / 1024 / 1024} MB limit`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  return buf.length ? JSON.parse(buf.toString("utf8")) : {};
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  // Keep the served path inside public/.
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": STATIC_TYPES[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

const AUDIO_TYPES = {
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".webm": "audio/webm",
  ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
};

function serveAudio(res, clip) {
  const file = path.join(AUDIO_DIR, clip.file);
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": AUDIO_TYPES[path.extname(file)] || clip.mime || "application/octet-stream",
    "Content-Length": fs.statSync(file).size,
    "Accept-Ranges": "none",
  });
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------------------------ *
 * Benchmark execution
 * ------------------------------------------------------------------ */

/** Run `fn` over `items` with a bounded number in flight, reporting each finish. */
async function mapLimit(items, limit, fn, onResult) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
      onResult?.(items[i], i, out[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const TIMEOUT_MS = Number(process.env.STT_BENCH_TIMEOUT_MS || 300000);

async function runOne(provider, clip, buffer, language) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      provider.run({ buffer, mime: clip.mime, filename: clip.originalName, language }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      ),
    ]);
    const text = String(result?.text || "").trim();
    return {
      ok: true,
      text,
      ms: Date.now() - started,
      raw: result?.raw ?? null,
      empty: text.length === 0,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), ms: Date.now() - started };
  }
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

async function route(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      providers: providerStatus(),
      languages: LANGUAGE_PRESETS,
      envLoaded,
      timeoutMs: TIMEOUT_MS,
      maxBodyMb: MAX_BODY / 1024 / 1024,
    });
  }

  if (req.method === "GET" && pathname === "/api/clips") {
    return sendJson(res, 200, { clips: listClips() });
  }

  // Raw-body upload: the browser PUTs the file bytes, metadata rides in headers.
  if (req.method === "POST" && pathname === "/api/clips") {
    const buffer = await readBody(req);
    if (!buffer.length) return sendJson(res, 400, { error: "Empty upload" });
    const clip = addClip({
      buffer,
      mime: req.headers["content-type"],
      originalName: decodeURIComponent(String(req.headers["x-filename"] || "audio")),
      userLabel: decodeURIComponent(String(req.headers["x-user-label"] || "")),
      source: "upload",
    });
    return sendJson(res, 201, { clip });
  }

  // Pull clips straight from S3 / any HTTPS URL (e.g. segment_attempts.audio_url).
  if (req.method === "POST" && pathname === "/api/clips/from-url") {
    const { urls = [] } = await readJson(req);
    const added = [];
    const failed = [];
    for (const entry of urls) {
      const item = typeof entry === "string" ? { url: entry } : entry;
      try {
        const r = await fetch(item.url, { redirect: "follow" });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const buffer = Buffer.from(await r.arrayBuffer());
        if (!buffer.length) throw new Error("Empty response body");
        added.push(
          addClip({
            buffer,
            mime: r.headers.get("content-type"),
            originalName: item.url.split("/").pop()?.split("?")[0] || "audio",
            userLabel: item.label || "",
            source: "url",
            sourceUrl: item.url,
          })
        );
      } catch (err) {
        failed.push({ url: item.url, error: err?.message || String(err) });
      }
    }
    return sendJson(res, 200, { added, failed });
  }

  const clipMatch = pathname.match(/^\/api\/clips\/([a-f0-9]{16})$/);
  if (clipMatch) {
    const id = clipMatch[1];
    if (req.method === "PATCH") {
      const clip = updateClip(id, await readJson(req));
      return clip ? sendJson(res, 200, { clip }) : sendJson(res, 404, { error: "No such clip" });
    }
    if (req.method === "DELETE") {
      return sendJson(res, 200, { deleted: deleteClip(id) });
    }
  }

  const audioMatch = pathname.match(/^\/api\/audio\/([a-f0-9]{16})$/);
  if (req.method === "GET" && audioMatch) {
    const clip = getClip(audioMatch[1]);
    if (!clip) return sendJson(res, 404, { error: "No such clip" });
    return serveAudio(res, clip);
  }

  if (req.method === "POST" && pathname === "/api/run") {
    const { clipIds = [], modelIds = [], language = "en-AU", concurrency = 4 } = await readJson(req);

    const clips = clipIds.map(getClip).filter(Boolean);
    const providers = modelIds.map(getProvider).filter(Boolean);
    if (!clips.length) return sendJson(res, 400, { error: "Select at least one audio clip." });
    if (!providers.length) return sendJson(res, 400, { error: "Select at least one model." });

    const status = new Map(providerStatus().map((p) => [p.id, p]));
    const blocked = providers.filter((p) => !status.get(p.id)?.enabled);
    if (blocked.length) {
      return sendJson(res, 400, {
        error:
          "Missing credentials for: " +
          blocked.map((p) => `${p.label} (${status.get(p.id).missing.join(", ")})`).join("; "),
      });
    }

    const jobs = [];
    for (const clip of clips) for (const provider of providers) jobs.push({ clip, provider });

    const buffers = new Map(clips.map((c) => [c.id, readClipBuffer(c)]));
    const startedAt = Date.now();

    // A 15-clip x 13-model sweep is ~200 calls, so stream each cell back as it
    // lands instead of making the browser wait on one long request.
    const streaming = url.searchParams.get("stream") === "1";
    if (streaming) {
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.write(JSON.stringify({ type: "start", total: jobs.length }) + "\n");
    }

    let finished = 0;
    const results = await mapLimit(
      jobs,
      Math.max(1, Math.min(8, concurrency)),
      ({ clip, provider }) => runOne(provider, clip, buffers.get(clip.id), language),
      ({ clip, provider }, _i, result) => {
        if (!streaming) return;
        res.write(
          JSON.stringify({
            type: "cell",
            clipId: clip.id,
            modelId: provider.id,
            done: ++finished,
            total: jobs.length,
            result,
          }) + "\n"
        );
      }
    );

    const cells = {};
    jobs.forEach(({ clip, provider }, i) => {
      cells[clip.id] ??= {};
      cells[clip.id][provider.id] = results[i];
    });

    const clipMeta = clips.map((c) => ({
      id: c.id,
      label: c.userLabel,
      originalName: c.originalName,
      mime: c.mime,
      bytes: c.bytes,
      sourceUrl: c.sourceUrl,
      reference: c.reference || "",
    }));

    const { scored, leaderboard, hasReferences, rankedBy } = scoreRun(clipMeta, cells);

    const run = {
      runAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      language,
      // Recorded so a saved run always says which model produced which transcript.
      models: providers.map((p) => ({ id: p.id, label: p.label, vendor: p.vendor, baseline: !!p.baseline })),
      clips: clipMeta,
      cells,
      scored,
      leaderboard,
      hasReferences,
      rankedBy,
    };
    run.savedAs = saveRun(run);

    if (streaming) {
      res.write(JSON.stringify({ type: "done", run }) + "\n");
      return res.end();
    }
    return sendJson(res, 200, run);
  }

  if (req.method === "POST" && pathname === "/api/diff") {
    const { reference = "", hypothesis = "" } = await readJson(req);
    return sendJson(res, 200, { tokens: diffTokens(reference, hypothesis) });
  }

  // Rescore a saved run after references are typed in - no API calls, no cost.
  if (req.method === "POST" && pathname === "/api/rescore") {
    const run = loadLatestRun();
    if (!run) return sendJson(res, 404, { error: "No run to rescore" });
    const fresh = new Map(listClips().map((c) => [c.id, c.reference || ""]));
    run.clips = run.clips.map((c) => ({ ...c, reference: fresh.get(c.id) ?? c.reference }));
    const { scored, leaderboard, hasReferences, rankedBy } = scoreRun(run.clips, run.cells);
    Object.assign(run, { scored, leaderboard, hasReferences, rankedBy });
    run.savedAs = saveRun(run);
    return sendJson(res, 200, run);
  }

  if (req.method === "GET" && pathname === "/api/runs") {
    return sendJson(res, 200, { runs: listRuns(), latest: loadLatestRun() });
  }

  if (req.method === "GET" && pathname === "/api/run") {
    const name = url.searchParams.get("name");
    try {
      return sendJson(res, 200, name ? loadRun(name) : loadLatestRun());
    } catch (err) {
      return sendJson(res, 404, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/export.csv") {
    const run = loadLatestRun();
    if (!run) return sendJson(res, 404, { error: "No run yet" });
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["user_label", "clip_id", "source_file", "model_id", "model_label", "vendor",
       "ok", "latency_ms", "wer", "accuracy", "cer", "consensus", "transcript", "error"].join(","),
    ];
    for (const clip of run.clips) {
      for (const m of run.models) {
        const cell = run.cells[clip.id]?.[m.id] || {};
        const s = run.scored[clip.id]?.[m.id] || {};
        rows.push([
          clip.label, clip.id, clip.originalName, m.id, m.label, m.vendor,
          cell.ok ? "yes" : "no", cell.ms ?? "",
          s.wer?.toFixed(4) ?? "", s.accuracy?.toFixed(4) ?? "", s.cer?.toFixed(4) ?? "",
          s.consensus?.toFixed(4) ?? "", cell.text ?? "", cell.error ?? "",
        ].map(esc).join(","));
      }
    }
    const csv = rows.join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stt-benchmark-${run.runAt.slice(0, 19).replace(/:/g, "-")}.csv"`,
    });
    return res.end(csv);
  }

  if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown endpoint" });
  return serveStatic(res, pathname);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  route(req, res, url).catch((err) => {
    console.error(`[stt-bench] ${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || "Internal error" });
    else res.end();
  });
});

// Bind to loopback only - this thing holds live API keys.
server.listen(PORT, "127.0.0.1", () => {
  const ready = providerStatus().filter((p) => p.enabled);
  console.log(`\n  STT benchmark  ->  http://localhost:${PORT}\n`);
  console.log(`  env vars loaded from .env files: ${envLoaded}`);
  console.log(`  models ready (${ready.length}/${PROVIDERS.length}):`);
  for (const p of providerStatus()) {
    console.log(`    ${p.enabled ? "[ok]  " : "[----]"} ${p.label.padEnd(38)} ${p.enabled ? "" : "needs " + p.missing.join(", ")}`);
  }
  console.log("");
});
