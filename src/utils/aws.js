import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { randomUUID } from "node:crypto";
import path from "node:path";

const allowedAudioMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac"
]);

// Validate AWS config at import time so failures are visible immediately
if (!process.env.AWS_REGION) {
  console.error("[S3] FATAL: AWS_REGION env var is not set — S3 uploads will fail");
}
if (!process.env.AWS_S3_BUCKET_NAME) {
  console.error("[S3] FATAL: AWS_S3_BUCKET_NAME env var is not set — S3 uploads will fail");
}

const s3 = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-2",
  maxAttempts: 2,                 // Reduce retries (default 3) to fail faster
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    socketTimeout: 15000,         // Reduced from 30s to 15s
  }),
});

function extFromMime(mimetype, originalname) {
  const map = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac"
  };

  if (map[mimetype]) return map[mimetype];
  const fromName = originalname ? path.extname(originalname).toLowerCase() : "";
  return fromName || "";
}

export async function uploadAudioToS3({ buffer, mimetype, originalname, keyPrefix = "audios" }) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_REGION;

  if (!bucket) throw new Error("AWS_S3_BUCKET_NAME is not set — cannot upload to S3");
  if (!region) throw new Error("AWS_REGION is not set — cannot upload to S3");
  if (!buffer || buffer.length === 0) throw new Error("Empty file buffer — nothing to upload");
  if (!allowedAudioMimeTypes.has(mimetype)) throw new Error(`Unsupported audio type: ${mimetype}`);

  const prefix = String(keyPrefix).replace(/^\/+|\/+$/g, "");
  const ext = extFromMime(mimetype, originalname);
  const key = `${prefix}/${randomUUID()}${ext}`;

  console.log(`[S3] Uploading ${originalname} (${mimetype}, ${(buffer.length / 1024).toFixed(1)}KB) → s3://${bucket}/${key}`);

  // Abort after 20 seconds to prevent indefinite hangs
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 20000);

  try {
    const res = await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype
      }),
      { abortSignal: abortController.signal }
    );

    const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/g, "");
    const url = base ? `${base}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    console.log(`[S3] Upload complete → ${url}`);
    return { bucket, key, etag: res.ETag, url };
  } catch (err) {
    if (err.name === "AbortError" || abortController.signal.aborted) {
      throw new Error(`S3 upload timed out after 20 seconds. Check AWS credentials and bucket '${bucket}' in region '${region}'.`);
    }
    console.error(`[S3] Upload failed for ${originalname}:`, err.message);
    throw new Error(`S3 upload failed: ${err.message}. Check AWS_REGION, AWS_S3_BUCKET_NAME, and AWS credentials.`);
  } finally {
    clearTimeout(timeout);
  }
}
