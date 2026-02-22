import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

const s3 = new S3Client({ region: process.env.AWS_REGION });

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

  if (!bucket) throw new Error("AWS_S3_BUCKET_NAME is required");
  if (!region) throw new Error("AWS_REGION is required");
  if (!allowedAudioMimeTypes.has(mimetype)) throw new Error(`Unsupported audio type: ${mimetype}`);

  const prefix = String(keyPrefix).replace(/^\/+|\/+$/g, "");
  const ext = extFromMime(mimetype, originalname);
  const key = `${prefix}/${randomUUID()}${ext}`;

  const res = await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype
    })
  );

  const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/g, "");
  const url = base ? `${base}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  return { bucket, key, etag: res.ETag, url };
}
