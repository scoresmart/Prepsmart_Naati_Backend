/**
 * Flat-file store. Everything lives under stt-benchmark/ so the harness can be
 * deleted in one go once the model decision is made.
 *
 *   audio/            the uploaded clips, saved under an opaque id
 *   audio/index.json  clip metadata (user label, reference transcript, source)
 *   results/          one JSON per benchmark run + latest.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AUDIO_DIR = path.join(ROOT, "audio");
export const RESULTS_DIR = path.join(ROOT, "results");
const INDEX = path.join(AUDIO_DIR, "index.json");

for (const dir of [AUDIO_DIR, RESULTS_DIR]) fs.mkdirSync(dir, { recursive: true });

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return { clips: [] };
  }
}

function writeIndex(data) {
  fs.writeFileSync(INDEX, JSON.stringify(data, null, 2));
}

export function listClips() {
  return readIndex().clips;
}

export function getClip(id) {
  return readIndex().clips.find((c) => c.id === id) || null;
}

export function readClipBuffer(clip) {
  return fs.readFileSync(path.join(AUDIO_DIR, clip.file));
}

const EXT_BY_MIME = {
  "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
  "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
  "audio/webm": ".webm", "video/webm": ".webm",
  "audio/ogg": ".ogg", "audio/opus": ".ogg",
  "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac",
  "audio/flac": ".flac", "audio/x-flac": ".flac",
};

// Container sniffing, because browsers and S3 both lie about audio MIME types.
function sniffMime(buf, fallback) {
  const head = buf.subarray(0, 16);
  const ascii = head.toString("latin1");
  if (ascii.startsWith("RIFF") && buf.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (ascii.startsWith("OggS")) return "audio/ogg";
  if (ascii.startsWith("fLaC")) return "audio/flac";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "audio/webm";
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";
  if (ascii.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return String(fallback || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

export function addClip({ buffer, mime, originalName, userLabel, source = "upload", sourceUrl = null }) {
  const detected = sniffMime(buffer, mime);
  const ext = EXT_BY_MIME[detected] || path.extname(originalName || "") || ".bin";
  const id = crypto.randomBytes(8).toString("hex");
  const file = `${id}${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, file), buffer);

  const data = readIndex();
  const clip = {
    id,
    file,
    mime: detected,
    declaredMime: String(mime || "").split(";")[0] || null,
    originalName: originalName || file,
    userLabel: userLabel || `User ${data.clips.length + 1}`,
    reference: "",
    bytes: buffer.length,
    source,
    sourceUrl,
    addedAt: new Date().toISOString(),
  };
  data.clips.push(clip);
  writeIndex(data);
  return clip;
}

export function updateClip(id, patch) {
  const data = readIndex();
  const clip = data.clips.find((c) => c.id === id);
  if (!clip) return null;
  for (const key of ["userLabel", "reference"]) {
    if (key in patch) clip[key] = String(patch[key] ?? "");
  }
  writeIndex(data);
  return clip;
}

export function deleteClip(id) {
  const data = readIndex();
  const i = data.clips.findIndex((c) => c.id === id);
  if (i === -1) return false;
  const [clip] = data.clips.splice(i, 1);
  try { fs.unlinkSync(path.join(AUDIO_DIR, clip.file)); } catch { /* already gone */ }
  writeIndex(data);
  return true;
}

export function saveRun(run) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(RESULTS_DIR, `run-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(run, null, 2));
  return path.basename(file);
}

export function loadLatestRun() {
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, "latest.json"), "utf8"));
  } catch {
    return null;
  }
}

export function listRuns() {
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .sort()
    .reverse();
}

export function loadRun(name) {
  if (!/^run-[\w-]+\.json$/.test(name)) throw new Error("bad run name");
  return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, name), "utf8"));
}
