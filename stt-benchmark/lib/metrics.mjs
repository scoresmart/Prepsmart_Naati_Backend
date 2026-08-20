/**
 * Accuracy scoring for the transcript comparison.
 *
 * Two modes, because you will not always have a hand-written reference:
 *
 *   1. Reference mode  - you type the true transcript for a clip, and every
 *      model is scored against it with WER / CER. This is the real measure.
 *
 *   2. Consensus mode  - no reference available. Each model is scored on how
 *      closely it agrees with all the *other* models on the same clip. A model
 *      that disagrees with everyone is usually the one that got it wrong.
 *      This is a proxy, not ground truth - it rewards the majority, so it
 *      cannot detect an error that every model makes together.
 */

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

// Contractions and spelling variants that should not count as errors.
const EQUIVALENTS = new Map(
  Object.entries({
    "dont": "do not", "doesnt": "does not", "didnt": "did not",
    "cant": "can not", "cannot": "can not", "wont": "will not",
    "isnt": "is not", "arent": "are not", "wasnt": "was not", "werent": "were not",
    "im": "i am", "ive": "i have", "id": "i would", "ill": "i will",
    "youre": "you are", "youve": "you have", "theyre": "they are",
    "hes": "he is", "shes": "she is", "its": "it is", "thats": "that is",
    "theres": "there is", "whats": "what is", "lets": "let us",
    "gonna": "going to", "wanna": "want to", "gotta": "got to",
    "ok": "okay", "alright": "all right",
    "mr": "mister", "mrs": "missus", "dr": "doctor", "st": "street",
  })
);

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Strip everything that is a formatting choice rather than a recognition
 * result: casing, punctuation, filler words, contraction style.
 */
export function normalize(text, { dropFillers = true, spellDigits = true } = {}) {
  let s = String(text || "").toLowerCase();

  // Unicode-aware: keep letters/marks/digits from any script (Hindi, Urdu, ...).
  s = s.replace(/[^\p{L}\p{M}\p{N}\s']/gu, " ");
  s = s.replace(/'/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return [];

  let words = s.split(" ");

  words = words.flatMap((w) => {
    const eq = EQUIVALENTS.get(w);
    if (eq) return eq.split(" ");
    // "2024" -> "two zero two four" so digit-vs-word styling is not an error.
    if (spellDigits && /^\p{Nd}+$/u.test(w)) return [...w].map((d) => DIGITS[Number(d)] ?? d);
    return [w];
  });

  if (dropFillers) {
    const fillers = new Set(["uh", "um", "uhm", "erm", "er", "ah", "hmm", "mm", "mhm", "eh"]);
    words = words.filter((w) => !fillers.has(w));
  }

  return words;
}

/* ------------------------------------------------------------------ *
 * Edit distance
 * ------------------------------------------------------------------ */

/** Levenshtein over an array of tokens, with the S/D/I breakdown. */
export function editOps(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return { distance: m, sub: 0, del: 0, ins: m };
  if (m === 0) return { distance: n, sub: 0, del: n, ins: 0 };

  // cost + op counts per cell, rolling two rows to stay O(m) in memory.
  const make = (len) => Array.from({ length: len }, () => ({ c: 0, s: 0, d: 0, i: 0 }));
  let prev = make(m + 1);
  let cur = make(m + 1);

  for (let j = 0; j <= m; j++) prev[j] = { c: j, s: 0, d: 0, i: j };

  for (let i = 1; i <= n; i++) {
    cur[0] = { c: i, s: 0, d: i, i: 0 };
    for (let j = 1; j <= m; j++) {
      const match = ref[i - 1] === hyp[j - 1];
      const subCell = prev[j - 1];
      const delCell = prev[j];
      const insCell = cur[j - 1];

      const subCost = subCell.c + (match ? 0 : 1);
      const delCost = delCell.c + 1;
      const insCost = insCell.c + 1;
      const best = Math.min(subCost, delCost, insCost);

      if (best === subCost) {
        cur[j] = { c: best, s: subCell.s + (match ? 0 : 1), d: subCell.d, i: subCell.i };
      } else if (best === delCost) {
        cur[j] = { c: best, s: delCell.s, d: delCell.d + 1, i: delCell.i };
      } else {
        cur[j] = { c: best, s: insCell.s, d: insCell.d, i: insCell.i + 1 };
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  const f = prev[m];
  return { distance: f.c, sub: f.s, del: f.d, ins: f.i };
}

/** Word error rate of `hyp` against `ref`. Can exceed 1 when hyp rambles. */
export function wer(refText, hypText, opts) {
  const ref = normalize(refText, opts);
  const hyp = normalize(hypText, opts);
  if (!ref.length) return { wer: hyp.length ? 1 : 0, refWords: 0, ...editOps(ref, hyp) };
  const ops = editOps(ref, hyp);
  return { wer: ops.distance / ref.length, refWords: ref.length, ...ops };
}

/** Character error rate, on the normalised token stream joined by spaces. */
export function cer(refText, hypText, opts) {
  const ref = [...normalize(refText, opts).join(" ")];
  const hyp = [...normalize(hypText, opts).join(" ")];
  if (!ref.length) return hyp.length ? 1 : 0;
  return editOps(ref, hyp).distance / ref.length;
}

/** 0..1 similarity between two transcripts (symmetric, length-normalised). */
export function similarity(a, b, opts) {
  const A = normalize(a, opts);
  const B = normalize(b, opts);
  const span = Math.max(A.length, B.length);
  if (!span) return 1;
  return Math.max(0, 1 - editOps(A, B).distance / span);
}

/* ------------------------------------------------------------------ *
 * Word-level diff, for highlighting in the UI
 * ------------------------------------------------------------------ */

/**
 * Aligns reference and hypothesis and returns tagged tokens:
 *   { op: "ok" | "sub" | "del" | "ins", ref, hyp }
 * "del" = the model missed a word, "ins" = the model invented one.
 */
export function diffTokens(refText, hypText, opts) {
  const ref = normalize(refText, opts);
  const hyp = normalize(hypText, opts);
  const n = ref.length;
  const m = hyp.length;

  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
        d[i - 1][j] + 1,
        d[i][j - 1] + 1
      );
    }
  }

  const out = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      out.push(
        ref[i - 1] === hyp[j - 1]
          ? { op: "ok", ref: ref[i - 1], hyp: hyp[j - 1] }
          : { op: "sub", ref: ref[i - 1], hyp: hyp[j - 1] }
      );
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ op: "del", ref: ref[i - 1], hyp: null });
      i--;
    } else {
      out.push({ op: "ins", ref: null, hyp: hyp[j - 1] });
      j--;
    }
  }
  return out.reverse();
}

/* ------------------------------------------------------------------ *
 * Scoring a whole run
 * ------------------------------------------------------------------ */

/**
 * @param clips  [{ id, label, reference }]
 * @param cells  { [clipId]: { [modelId]: { ok, text, ms, error } } }
 * @returns per-cell scores + a per-model leaderboard
 */
export function scoreRun(clips, cells, opts) {
  const scored = {};
  const perModel = new Map();

  const bump = (modelId) => {
    if (!perModel.has(modelId)) {
      perModel.set(modelId, {
        modelId, runs: 0, failures: 0, msTotal: 0,
        werSum: 0, werN: 0, cerSum: 0, cerN: 0,
        consensusSum: 0, consensusN: 0, wordsOut: 0, wins: 0,
      });
    }
    return perModel.get(modelId);
  };

  for (const clip of clips) {
    const row = cells[clip.id] || {};
    scored[clip.id] = {};

    const modelIds = Object.keys(row);
    const okIds = modelIds.filter((id) => row[id]?.ok && row[id]?.text);

    for (const id of modelIds) {
      const cell = row[id];
      const agg = bump(id);
      agg.runs += 1;
      if (!cell?.ok) {
        agg.failures += 1;
        scored[clip.id][id] = { ok: false, error: cell?.error || "failed" };
        continue;
      }
      agg.msTotal += cell.ms || 0;
      agg.wordsOut += normalize(cell.text, opts).length;

      const entry = { ok: true, ms: cell.ms, words: normalize(cell.text, opts).length };

      if (clip.reference && clip.reference.trim()) {
        const w = wer(clip.reference, cell.text, opts);
        entry.wer = w.wer;
        entry.accuracy = Math.max(0, 1 - w.wer);
        entry.sub = w.sub;
        entry.del = w.del;
        entry.ins = w.ins;
        entry.refWords = w.refWords;
        entry.cer = cer(clip.reference, cell.text, opts);
        agg.werSum += w.wer; agg.werN += 1;
        agg.cerSum += entry.cer; agg.cerN += 1;
      }

      // Consensus: mean similarity to every other successful model on this clip.
      const peers = okIds.filter((other) => other !== id);
      if (peers.length) {
        const sims = peers.map((other) => similarity(row[other].text, cell.text, opts));
        entry.consensus = sims.reduce((a, b) => a + b, 0) / sims.length;
        agg.consensusSum += entry.consensus; agg.consensusN += 1;
      }

      scored[clip.id][id] = entry;
    }

    // Per-clip winner: lowest WER if we have a reference, else best consensus.
    const ranked = okIds
      .map((id) => ({ id, e: scored[clip.id][id] }))
      .filter(({ e }) => (clip.reference?.trim() ? typeof e.wer === "number" : typeof e.consensus === "number"))
      .sort((a, b) =>
        clip.reference?.trim() ? a.e.wer - b.e.wer : b.e.consensus - a.e.consensus
      );
    if (ranked.length) {
      scored[clip.id][ranked[0].id].bestOnClip = true;
      bump(ranked[0].id).wins += 1;
    }
  }

  const leaderboard = [...perModel.values()]
    .map((a) => ({
      modelId: a.modelId,
      runs: a.runs,
      failures: a.failures,
      successRate: a.runs ? (a.runs - a.failures) / a.runs : 0,
      avgMs: a.runs - a.failures ? Math.round(a.msTotal / (a.runs - a.failures)) : null,
      avgWer: a.werN ? a.werSum / a.werN : null,
      avgAccuracy: a.werN ? Math.max(0, 1 - a.werSum / a.werN) : null,
      avgCer: a.cerN ? a.cerSum / a.cerN : null,
      avgConsensus: a.consensusN ? a.consensusSum / a.consensusN : null,
      wins: a.wins,
      wordsOut: a.wordsOut,
    }))
    .sort((a, b) => {
      // Rank by WER when references exist, otherwise by consensus.
      if (a.avgWer !== null && b.avgWer !== null) return a.avgWer - b.avgWer;
      if (a.avgWer !== null) return -1;
      if (b.avgWer !== null) return 1;
      return (b.avgConsensus ?? -1) - (a.avgConsensus ?? -1);
    });

  const hasReferences = clips.some((c) => c.reference && c.reference.trim());
  return { scored, leaderboard, hasReferences, rankedBy: hasReferences ? "wer" : "consensus" };
}
