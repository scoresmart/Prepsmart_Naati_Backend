# STT model comparison harness

A local-only page for answering one question: **which speech-to-text model is most
accurate on our users' actual audio?**

It runs the same set of clips through every configured model, labels each transcript
with the model that produced it, and scores them against each other.

Nothing here is wired into the API. It reads the same env vars production reads,
so it measures what production would actually get. Delete the folder when the
decision is made.

---

## Run it

```bash
cd stt-benchmark
cp .env.example .env      # fill in whatever keys you have
node server.mjs           # -> http://localhost:5055
```

No `npm install`. There are zero runtime dependencies — just Node 18+ built-ins.
The server binds to `127.0.0.1` only, because it holds live API keys.

On start it prints which models are ready:

```
  models ready (7/13):
    [ok]   Azure Fast Transcription
    [----] Google STT v1 (default)              needs GOOGLE_SPEECH_API_KEY
    ...
```

Anything missing a key is greyed out in the UI rather than failing mid-run.
The harness also reads the backend's own `../.env`, so keys already configured
for the API are picked up automatically.

---

## The models

| Model | Vendor | Auth needed |
|---|---|---|
| Azure Fast Transcription **(live in production today)** | Azure | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| Azure Fast Transcription + diarization | Azure | same |
| Google STT v1 (`default`) | Google | `GOOGLE_SPEECH_API_KEY` |
| Google STT v1 (`latest_long`) | Google | same |
| Google Chirp 2 (STT v2) | Google | service account JSON |
| Gemini 2.5 Flash (audio) | Google | `GEMINI_API_KEY` |
| Gemini 2.5 Pro (audio) | Google | same |
| OpenAI `gpt-4o-transcribe` | OpenAI | `OPENAI_API_KEY` |
| OpenAI `gpt-4o-mini-transcribe` | OpenAI | same |
| OpenAI `whisper-1` | OpenAI | same |
| Deepgram Nova-3 | Deepgram | `DEEPGRAM_API_KEY` |
| ElevenLabs Scribe v1 | ElevenLabs | `ELEVENLABS_API_KEY` |
| AWS Transcribe | AWS | `AWS_TRANSCRIBE_BUCKET` + AWS SDK |

By default the UI pre-selects four — the production baseline plus one strong
contender per vendor — because a 15-clip sweep of all thirteen is ~200 billable
API calls. "Select all available" opts into the full sweep.

### Format support, worth knowing before you pick clips

- **Google STT v1** only decodes wav / flac / webm-opus / ogg-opus / mp3, capped
  at 10 MB or ~60 s. It will refuse `.m4a` outright.
- **Google Chirp 2** auto-detects the container, so it handles everything, but
  the inline endpoint is also capped at ~60 s.
- **Azure, OpenAI, Gemini, Deepgram, ElevenLabs** take the browser's `.webm`
  recordings directly, which is what `segment_attempts.audio_url` mostly holds.

Clips longer than a minute will fail on the two Google Speech endpoints and
succeed everywhere else. That is a real limitation of those APIs, not a harness
bug — the error text says so in the cell.

---

## Loading the audio

Two ways, both in step 2 of the page:

1. **Drop files** — 10–15 `.wav` / `.webm` / `.mp3` files straight from disk.
2. **Paste URLs** — one per line, optional label after a `|`:

   ```
   https://bucket.s3.ap-southeast-2.amazonaws.com/audios/abc.webm | User 3 — Hindi seg 2
   ```

   The server fetches each URL, so presigned S3 links work. To get real user
   clips, pull `audio_url` from `segment_attempts` or `mock_test_attempts`:

   ```sql
   SELECT sa.user_id, sa.audio_url
   FROM segment_attempts sa
   WHERE sa.audio_url IS NOT NULL
   ORDER BY sa.id DESC
   LIMIT 15;
   ```

   If the bucket is private, presign them first (`aws s3 presign <key>
   --expires-in 3600 --profile prepsmart`).

---

## How accuracy is scored

**With reference transcripts** (type the true text into a clip's reference box):
models are scored by **WER** — word error rate, the standard ASR metric.
`WER = (substitutions + deletions + insertions) / reference words`.
This is the number to trust.

**Without references**: ranked by **cross-model agreement** — how closely each
model matches the others on the same clip. A model that disagrees with everyone
is usually the one that got it wrong.

> Agreement is a proxy, not ground truth. It rewards the majority answer, so it
> cannot catch a mistake that every model makes together — which is exactly what
> happens with a hard accent or a domain term. Write references for even 3–4
> clips and hit **Re-score** (free, no API calls) for a real WER number.

Before comparing, both texts are normalised so formatting differences are not
counted as errors: casing, punctuation, contractions (`don't` = `do not`),
digits vs words (`24` = `two four`), and filler words (`um`, `uh`) are all
neutralised. Non-Latin scripts are preserved, so Hindi/Urdu/Punjabi clips score
correctly.

Click any cell to see that transcript diffed word-by-word against the reference,
alongside what every other model heard for the same clip.

---

## Output

- The matrix and leaderboard on the page, every transcript labelled with its model.
- `results/run-<timestamp>.json` — full run, saved automatically.
- **Export CSV** — one row per (clip × model) with transcript, WER, latency, errors.

---

## Layout

```
server.mjs          HTTP server + run orchestration (node:http, no framework)
lib/providers.mjs   one entry per model; add a model by adding an object here
lib/metrics.mjs     normalisation, WER/CER, word diff, leaderboard
lib/store.mjs       flat-file clip + results storage
public/             the page (vanilla JS, no build step)
audio/              uploaded clips        (git-ignored)
results/            saved runs            (git-ignored)
```

### Adding another model

Append one object to `PROVIDERS` in `lib/providers.mjs`:

```js
{
  id: "my-model",
  label: "My Model",
  vendor: "Google",
  needs: ["MY_API_KEY"],          // "A|B" if either key works
  note: "Shown under the checkbox.",
  run: async ({ buffer, mime, filename, language }) => {
    // ... call the API ...
    return { text, raw: { anythingElse } };
  },
}
```

It appears in the UI on next restart, enabled if its keys are present.
