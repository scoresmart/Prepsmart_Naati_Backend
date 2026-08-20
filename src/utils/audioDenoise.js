/**
 * Audio Denoising Pipeline using FFmpeg (free, no API keys needed)
 *
 * Pipeline:
 *   1. highpass=f=80        — remove low-frequency rumble (< 80 Hz)
 *   2. lowpass=f=8000       — remove high-frequency hiss  (> 8 kHz)
 *   3. afftdn=nf=-25        — FFT-based noise reduction (noise floor -25 dB)
 *   4. loudnorm             — normalize loudness (EBU R128)
 *   5. -ar 16000 -ac 1      — 16 kHz mono (optimal for Azure STT)
 *
 * Output: WAV buffer ready for Azure / pronunciation assessment
 */

import { execFile } from "node:child_process";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Check if FFmpeg is available on the system
 */
let ffmpegAvailable = null;
async function checkFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  return new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err) => {
      ffmpegAvailable = !err;
      if (!ffmpegAvailable) {
        console.warn("[AudioDenoise] FFmpeg not found — denoising disabled. Install with: sudo apt install ffmpeg");
      }
      resolve(ffmpegAvailable);
    });
  });
}

/**
 * Denoise an audio buffer using FFmpeg
 *
 * @param {Object} opts
 * @param {Buffer} opts.buffer   — raw audio buffer (webm, mp3, wav, etc.)
 * @param {string} opts.mimetype — e.g. "audio/webm", "audio/wav"
 * @param {Object} [opts.options] — optional overrides
 * @param {number} [opts.options.highpass=80]        — highpass cutoff Hz
 * @param {number} [opts.options.lowpass=8000]       — lowpass cutoff Hz
 * @param {number} [opts.options.noiseFloor=-25]     — afftdn noise floor dB
 * @param {number} [opts.options.sampleRate=16000]   — output sample rate
 * @param {boolean} [opts.options.normalize=true]    — apply loudnorm
 *
 * @returns {Promise<{buffer: Buffer, mimetype: string} | null>}
 *   Returns cleaned WAV buffer, or null if FFmpeg unavailable
 */
export async function denoiseAudio({ buffer, mimetype, options = {} }) {
  // Skip if FFmpeg not available — caller falls back to raw audio
  const available = await checkFfmpeg();
  if (!available) return null;

  const {
    highpass = 80,
    lowpass = 8000,
    noiseFloor = -25,
    sampleRate = 16000,
    normalize = true,
  } = options;

  // Determine input file extension
  const extMap = {
    "audio/webm":   ".webm",
    "audio/wav":    ".wav",
    "audio/mpeg":   ".mp3",
    "audio/mp3":    ".mp3",
    "audio/ogg":    ".ogg",
    "audio/mp4":    ".mp4",
    "audio/x-m4a":  ".m4a",
    "audio/aac":    ".aac",
    "audio/flac":   ".flac",
  };
  const inputExt = extMap[mimetype] || ".webm";

  // Create temp directory for this operation
  const tempDir = await mkdtemp(path.join(tmpdir(), "denoise-"));
  const inputPath = path.join(tempDir, `input${inputExt}`);
  const outputPath = path.join(tempDir, "output.wav");

  try {
    // Write input to temp file
    await writeFile(inputPath, buffer);

    // Build FFmpeg filter chain
    const filters = [
      `highpass=f=${highpass}`,
      `lowpass=f=${lowpass}`,
      `afftdn=nf=${noiseFloor}`,
    ];
    if (normalize) filters.push("loudnorm");
    const filterChain = filters.join(",");

    // Run FFmpeg
    const args = [
      "-y",                      // overwrite output
      "-i", inputPath,           // input file
      "-af", filterChain,        // audio filters
      "-ar", String(sampleRate), // sample rate
      "-ac", "1",                // mono
      "-c:a", "pcm_s16le",      // 16-bit PCM WAV
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      execFile("ffmpeg", args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          console.error("[AudioDenoise] FFmpeg error:", stderr || err.message);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });

    // Read the cleaned output
    const cleanedBuffer = await readFile(outputPath);
    console.log(
      `[AudioDenoise] Cleaned: ${(buffer.length / 1024).toFixed(1)}KB → ${(cleanedBuffer.length / 1024).toFixed(1)}KB (WAV 16kHz mono)`
    );

    return { buffer: cleanedBuffer, mimetype: "audio/wav" };
  } catch (err) {
    console.error("[AudioDenoise] Pipeline failed, using raw audio:", err.message);
    return null;
  } finally {
    // Clean up temp files
    try { await unlink(inputPath); } catch {}
    try { await unlink(outputPath); } catch {}
    try {
      const { rmdir } = await import("node:fs/promises");
      await rmdir(tempDir);
    } catch {}
  }
}
