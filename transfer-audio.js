/**
 * Transfer segment audio from Supabase → S3 and update DB URLs
 * Also transfers vocabulary audio to S3
 *
 * Usage: node transfer-audio.js
 *
 * Reads signed URLs from:
 *   ../../../exact-ui-clone/prepsmart-dialogue-audio-urls-2026-02-22.json
 *   ../../../exact-ui-clone/prepsmart-audio-urls-2026-02-22.json
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ─── Config ─── */
const DIALOGUE_AUDIO_PATH = path.resolve(
  __dirname,
  "../../../exact-ui-clone/prepsmart-dialogue-audio-urls-2026-02-22.json"
);
const VOCAB_AUDIO_PATH = path.resolve(
  __dirname,
  "../../../exact-ui-clone/prepsmart-audio-urls-2026-02-22.json"
);

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME;
const S3_REGION = process.env.AWS_REGION;
const S3_BASE = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

const s3 = new S3Client({ region: S3_REGION });

const CONCURRENCY = 5; // parallel downloads/uploads

/* ─── Helpers ─── */
async function downloadBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function s3KeyExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToS3(buffer, key, contentType = "audio/mpeg") {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${S3_BASE}/${key}`;
}

/* ─── Process in batches ─── */
async function processBatch(items, fn, concurrency = CONCURRENCY) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/* ─── MAIN ─── */
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  console.log("Connected to MySQL\n");

  /* ═══════ PART 1: Segment Audio (dialogue-audio bucket → S3) ═══════ */
  console.log("═══ SEGMENT AUDIO TRANSFER ═══");

  // Load signed URLs
  const dialogueAudioSignedUrls = {};
  if (fs.existsSync(DIALOGUE_AUDIO_PATH)) {
    const data = JSON.parse(fs.readFileSync(DIALOGUE_AUDIO_PATH, "utf8"));
    const files = data.storage_files?.["dialogue-audio"] || [];
    for (const f of files) {
      dialogueAudioSignedUrls[f.path] = f.signedUrl;
    }
    console.log(`Loaded ${files.length} dialogue signed URLs`);
  } else {
    console.error("Dialogue audio URLs file not found!");
    process.exit(1);
  }

  // Get all segments with non-null, non-S3 audio_url
  const [segments] = await conn.query(
    `SELECT id, audio_url FROM segments
     WHERE audio_url IS NOT NULL
       AND audio_url != ''
       AND audio_url NOT LIKE 'https://${S3_BUCKET}%'`
  );
  console.log(`Found ${segments.length} segments needing audio transfer\n`);

  let segOk = 0,
    segFail = 0,
    segSkip = 0;

  for (let i = 0; i < segments.length; i += CONCURRENCY) {
    const batch = segments.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (seg) => {
        const relPath = seg.audio_url;
        const filename = path.basename(relPath);
        const s3Key = `audios/segments/${filename}`;

        // Already on S3?
        if (await s3KeyExists(s3Key)) {
          const s3Url = `${S3_BASE}/${s3Key}`;
          await conn.query("UPDATE segments SET audio_url = ? WHERE id = ?", [
            s3Url,
            seg.id,
          ]);
          return "skip";
        }

        // Find signed URL
        const signedUrl = dialogueAudioSignedUrls[relPath];
        if (!signedUrl) {
          // Try fuzzy match by filename
          const entry = Object.entries(dialogueAudioSignedUrls).find(([p]) =>
            p.endsWith(filename)
          );
          if (!entry) throw new Error(`No signed URL for: ${relPath}`);
          var downloadUrl = entry[1];
        } else {
          var downloadUrl = signedUrl;
        }

        const buffer = await downloadBuffer(downloadUrl);
        const ext = path.extname(filename);
        const s3Url = await uploadToS3(
          buffer,
          s3Key,
          ext === ".m4a" ? "audio/mp4" : "audio/mpeg"
        );

        // Update DB
        await conn.query("UPDATE segments SET audio_url = ? WHERE id = ?", [
          s3Url,
          seg.id,
        ]);
        return "ok";
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "skip") segSkip++;
        else segOk++;
      } else {
        segFail++;
        console.warn(`  ⚠ ${r.reason?.message}`);
      }
    }

    const total = i + batch.length;
    if (total % 50 === 0 || total === segments.length) {
      console.log(
        `  Segments: ${total}/${segments.length} (${segOk} transferred, ${segSkip} already on S3, ${segFail} failed)`
      );
    }
  }

  console.log(
    `\n✓ Segments done: ${segOk} transferred, ${segSkip} skipped, ${segFail} failed`
  );

  /* ═══════ PART 2: Vocabulary Audio (audio bucket → S3) ═══════ */
  console.log("\n═══ VOCABULARY AUDIO TRANSFER ═══");

  // Vocabulary audio URLs are already full Supabase public URLs — bucket is public
  const [vocabRows] = await conn.query(
    `SELECT id, original_audio_url, converted_audio_url FROM vocabulary
     WHERE (original_audio_url IS NOT NULL AND original_audio_url NOT LIKE 'https://${S3_BUCKET}%')
        OR (converted_audio_url IS NOT NULL AND converted_audio_url NOT LIKE 'https://${S3_BUCKET}%')`
  );
  console.log(`Found ${vocabRows.length} vocabulary items needing audio transfer\n`);

  let vocOk = 0,
    vocFail = 0,
    vocSkip = 0;

  for (let i = 0; i < vocabRows.length; i += CONCURRENCY) {
    const batch = vocabRows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (v) => {
        let newOrigUrl = v.original_audio_url;
        let newConvUrl = v.converted_audio_url;

        // Transfer original audio
        if (
          v.original_audio_url &&
          !v.original_audio_url.startsWith(`https://${S3_BUCKET}`)
        ) {
          const filename = path.basename(
            new URL(v.original_audio_url).pathname
          );
          const s3Key = `audios/vocabulary/${filename}`;

          if (await s3KeyExists(s3Key)) {
            newOrigUrl = `${S3_BASE}/${s3Key}`;
          } else {
            const buffer = await downloadBuffer(v.original_audio_url);
            const ext = path.extname(filename);
            newOrigUrl = await uploadToS3(
              buffer,
              s3Key,
              ext === ".m4a" ? "audio/mp4" : "audio/mpeg"
            );
          }
        }

        // Transfer converted audio
        if (
          v.converted_audio_url &&
          !v.converted_audio_url.startsWith(`https://${S3_BUCKET}`)
        ) {
          const filename = path.basename(
            new URL(v.converted_audio_url).pathname
          );
          const s3Key = `audios/vocabulary/${filename}`;

          if (await s3KeyExists(s3Key)) {
            newConvUrl = `${S3_BASE}/${s3Key}`;
          } else {
            const buffer = await downloadBuffer(v.converted_audio_url);
            const ext = path.extname(filename);
            newConvUrl = await uploadToS3(
              buffer,
              s3Key,
              ext === ".m4a" ? "audio/mp4" : "audio/mpeg"
            );
          }
        }

        // Update DB
        await conn.query(
          "UPDATE vocabulary SET original_audio_url = ?, converted_audio_url = ? WHERE id = ?",
          [newOrigUrl, newConvUrl, v.id]
        );
        return "ok";
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") vocOk++;
      else {
        vocFail++;
        console.warn(`  ⚠ ${r.reason?.message}`);
      }
    }

    const total = i + batch.length;
    if (total % 100 === 0 || total === vocabRows.length) {
      console.log(
        `  Vocabulary: ${total}/${vocabRows.length} (${vocOk} ok, ${vocFail} failed)`
      );
    }
  }

  console.log(
    `\n✓ Vocabulary done: ${vocOk} transferred, ${vocFail} failed`
  );

  /* ═══════ VERIFY ═══════ */
  console.log("\n═══ VERIFICATION ═══");
  const [[segCheck]] = await conn.query(
    `SELECT COUNT(*) as cnt FROM segments WHERE audio_url LIKE 'https://${S3_BUCKET}%'`
  );
  const [[segTotal]] = await conn.query(
    `SELECT COUNT(*) as cnt FROM segments WHERE audio_url IS NOT NULL`
  );
  const [[vocCheckO]] = await conn.query(
    `SELECT COUNT(*) as cnt FROM vocabulary WHERE original_audio_url LIKE 'https://${S3_BUCKET}%'`
  );
  const [[vocCheckC]] = await conn.query(
    `SELECT COUNT(*) as cnt FROM vocabulary WHERE converted_audio_url LIKE 'https://${S3_BUCKET}%'`
  );
  console.log(
    `Segments with S3 audio: ${segCheck.cnt}/${segTotal.cnt}`
  );
  console.log(`Vocabulary with S3 original audio: ${vocCheckO.cnt}`);
  console.log(`Vocabulary with S3 converted audio: ${vocCheckC.cnt}`);

  console.log("\n🎉 Audio transfer complete!");
  await conn.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Transfer failed:", err);
  process.exit(1);
});
