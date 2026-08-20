/* STT benchmark UI — vanilla ES modules, no build step. */

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

const state = {
  providers: [],
  languages: [],
  selected: new Set(),
  clips: [],
  run: null,
};

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  const cfg = await (await fetch("/api/config")).json();
  state.providers = cfg.providers;
  state.languages = cfg.languages;

  const ready = cfg.providers.filter((p) => p.enabled).length;
  $("#envBadge").textContent = `${ready}/${cfg.providers.length} models configured · ${cfg.envLoaded} env vars loaded`;

  $("#language").append(
    ...cfg.languages.map((l) => el("option", { value: l.code, textContent: l.label }))
  );
  $("#language").value = "en-AU";

  // Default to one strong contender per vendor plus the production baseline,
  // rather than all 13 — a 15-clip sweep of everything is ~200 paid API calls.
  const DEFAULTS = ["azure-fast", "google-chirp2", "gemini-2.5-flash", "openai-gpt-4o-transcribe"];
  state.providers
    .filter((p) => p.enabled && DEFAULTS.includes(p.id))
    .forEach((p) => state.selected.add(p.id));
  renderProviders();

  await loadClips();

  const runs = await (await fetch("/api/runs")).json();
  if (runs.latest) renderResults(runs.latest);

  wireEvents();
  updateEstimate();
}

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

function renderProviders() {
  const host = $("#providers");
  host.textContent = "";

  for (const p of state.providers) {
    const on = state.selected.has(p.id);
    const box = el("input", { type: "checkbox", checked: on, disabled: !p.enabled });
    box.addEventListener("change", () => {
      box.checked ? state.selected.add(p.id) : state.selected.delete(p.id);
      renderProviders();
      updateEstimate();
    });

    const name = el("div", { className: "prov-name" }, p.label, el("span", { className: `tag ${p.vendor}`, textContent: p.vendor }));
    if (p.baseline) name.append(el("span", { className: "tag baseline", textContent: "in production" }));

    const body = el("div", {}, name, el("div", { className: "prov-note", textContent: p.note }));
    if (!p.enabled) body.append(el("div", { className: "prov-missing", textContent: "missing: " + p.missing.join(", ") }));

    host.append(el("label", { className: `prov ${p.enabled ? (on ? "on" : "") : "off"}` }, box, body));
  }

  const missing = state.providers.filter((p) => !p.enabled);
  $("#providerHint").textContent = missing.length
    ? `${missing.length} model(s) greyed out — add their keys to stt-benchmark/.env and restart the server to include them.`
    : "All models configured.";
}

/* ------------------------------------------------------------------ *
 * Clips
 * ------------------------------------------------------------------ */

async function loadClips() {
  state.clips = (await (await fetch("/api/clips")).json()).clips;
  renderClips();
}

function renderClips() {
  const host = $("#clips");
  host.textContent = "";
  $("#clipCounter").textContent = `${state.clips.length} clip${state.clips.length === 1 ? "" : "s"}`;

  state.clips.forEach((c, i) => {
    const label = el("input", { type: "text", value: c.userLabel, placeholder: "User label" });
    label.addEventListener("change", () => patchClip(c.id, { userLabel: label.value }));

    const ref = el("input", {
      type: "text", className: "ref", value: c.reference || "",
      placeholder: "Reference transcript (optional — enables real WER)",
    });
    ref.addEventListener("change", () => patchClip(c.id, { reference: ref.value }));

    const del = el("button", { className: "del", textContent: "×", title: "Remove clip" });
    del.addEventListener("click", async () => {
      await fetch(`/api/clips/${c.id}`, { method: "DELETE" });
      await loadClips();
      updateEstimate();
    });

    host.append(
      el("div", { className: "clip" },
        el("span", { className: "idx", textContent: String(i + 1) }),
        label,
        el("audio", { controls: true, src: `/api/audio/${c.id}`, preload: "none" }),
        ref,
        el("span", { className: "meta", textContent: `${(c.bytes / 1024).toFixed(0)} KB · ${c.mime.replace("audio/", "")}` }),
        del
      )
    );
  });

  if (!state.clips.length) {
    host.append(el("p", { className: "hint", textContent: "No clips loaded yet." }));
  }
}

async function patchClip(id, patch) {
  await fetch(`/api/clips/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const clip = state.clips.find((c) => c.id === id);
  if (clip) Object.assign(clip, patch);
}

async function uploadFiles(files) {
  const status = $("#runStatus");
  status.classList.remove("hidden");
  let done = 0;

  for (const f of files) {
    status.textContent = `Uploading ${++done}/${files.length}: ${f.name}`;
    const buf = await f.arrayBuffer();
    await fetch("/api/clips", {
      method: "POST",
      headers: {
        "Content-Type": f.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(f.name),
        "X-User-Label": encodeURIComponent(f.name.replace(/\.[^.]+$/, "")),
      },
      body: buf,
    });
  }

  status.classList.add("hidden");
  await loadClips();
  updateEstimate();
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

function updateEstimate() {
  const n = state.clips.length * state.selected.size;
  const base = `${state.clips.length} clips × ${state.selected.size} models = ${n} transcription calls`;
  $("#estimate").textContent = n
    ? n > 100 ? `${base} — that is a lot of billable calls; consider trimming models or clips.` : base
    : "Select models and load audio first.";
  $("#runBtn").disabled = !n;
}

async function runBenchmark() {
  const status = $("#runStatus");
  const total = state.clips.length * state.selected.size;
  status.classList.remove("hidden");
  status.textContent = "";
  status.append(
    el("div", { id: "runMsg", textContent: `Starting ${total} transcription calls…` }),
    el("div", { className: "bar" }, el("div", { id: "runBar" }))
  );
  $("#runBtn").disabled = true;

  // Show the empty matrix straight away so cells can fill in as they land.
  const pending = {
    runAt: new Date().toISOString(),
    elapsedMs: 0,
    language: $("#language").value,
    models: [...state.selected].map((id) => {
      const p = state.providers.find((x) => x.id === id);
      return { id, label: p.label, vendor: p.vendor, baseline: p.baseline };
    }),
    clips: state.clips.map((c) => ({
      id: c.id, label: c.userLabel, originalName: c.originalName,
      mime: c.mime, bytes: c.bytes, sourceUrl: c.sourceUrl, reference: c.reference || "",
    })),
    cells: {}, scored: {}, leaderboard: [], hasReferences: false, rankedBy: "consensus",
    inProgress: true,
  };
  renderResults(pending);

  const started = Date.now();

  try {
    const res = await fetch("/api/run?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipIds: state.clips.map((c) => c.id),
        modelIds: [...state.selected],
        language: $("#language").value,
        concurrency: Number($("#concurrency").value),
      }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Run failed (HTTP ${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalRun = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // NDJSON: everything up to the last newline is complete.
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (msg.type === "cell") {
          pending.cells[msg.clipId] ??= {};
          pending.cells[msg.clipId][msg.modelId] = msg.result;
          patchMatrixCell(pending, msg.clipId, msg.modelId, msg.result);
          const p = (msg.done / msg.total) * 100;
          $("#runBar").style.width = `${p}%`;
          $("#runMsg").textContent =
            `${msg.done}/${msg.total} calls done · ${((Date.now() - started) / 1000).toFixed(0)}s elapsed`;
        } else if (msg.type === "done") {
          finalRun = msg.run;
        }
      }
    }

    if (!finalRun) throw new Error("Stream ended before results arrived");

    $("#runBar").style.width = "100%";
    $("#runMsg").textContent =
      `Done in ${(finalRun.elapsedMs / 1000).toFixed(1)}s — saved as results/${finalRun.savedAs}`;
    renderResults(finalRun);
    $("#resultsCard").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    $("#runMsg").textContent = `Failed: ${err.message}`;
  } finally {
    $("#runBtn").disabled = false;
  }
}

/** Fill one matrix cell mid-run, without rebuilding the whole table. */
function patchMatrixCell(run, clipId, modelId, result) {
  const td = document.querySelector(`td[data-clip="${clipId}"][data-model="${modelId}"]`);
  if (!td) return;
  const model = run.models.find((m) => m.id === modelId);
  td.className = `cell ${result.ok ? "" : "err"}`;
  td.textContent = "";
  td.append(
    el("div", { className: "badge" }, model.label, result.ok ? ` · ${result.ms} ms` : ""),
    el("div", { className: "txt", textContent: result.ok ? (result.text || "(empty transcript returned)") : (result.error || "failed") })
  );
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");
const scoreClass = (wer) => (wer == null ? "" : wer <= 0.10 ? "good" : wer <= 0.25 ? "mid" : "poor");

function renderResults(run) {
  state.run = run;
  $("#resultsCard").classList.remove("hidden");
  renderVerdict(run);
  renderLeaderboard(run);
  renderMatrix(run);
}

function renderVerdict(run) {
  const host = $("#verdict");
  host.textContent = "";

  if (run.inProgress) {
    host.append("Run in progress — transcripts appear below as each model answers.");
    return;
  }

  const board = run.leaderboard.filter((r) => r.successRate > 0);
  if (!board.length) {
    host.append("Every call failed. Check the error text in the matrix below.");
    return;
  }

  const nameOf = (id) => run.models.find((m) => m.id === id)?.label || id;
  const best = board[0];
  const baseline = run.leaderboard.find((r) => run.models.find((m) => m.id === r.modelId)?.baseline);

  const line = el("div");
  if (run.hasReferences) {
    line.append(
      "Most accurate against your reference transcripts: ",
      el("b", { textContent: nameOf(best.modelId) }),
      ` — ${pct(best.avgAccuracy)} word accuracy (WER ${pct(best.avgWer)}), ${best.avgMs} ms average, won ${best.wins}/${run.clips.length} clips.`
    );
  } else {
    line.append(
      "No reference transcripts entered, so this is ranked by cross-model agreement. Closest to consensus: ",
      el("b", { textContent: nameOf(best.modelId) }),
      ` — ${pct(best.avgConsensus)} agreement, ${best.avgMs} ms average, won ${best.wins}/${run.clips.length} clips.`
    );
  }
  host.append(line);

  if (baseline && baseline.modelId !== best.modelId) {
    const bMetric = run.hasReferences ? baseline.avgWer : baseline.avgConsensus;
    const wMetric = run.hasReferences ? best.avgWer : best.avgConsensus;
    const delta = Math.abs((wMetric - bMetric) * 100).toFixed(1);
    host.append(
      el("div", { className: "caveat" },
        `Your current production model (${nameOf(baseline.modelId)}) ranks #${run.leaderboard.indexOf(baseline) + 1} — ` +
        `${delta} points ${run.hasReferences ? "worse WER" : "further from consensus"} than the leader.`)
    );
  }

  if (!run.hasReferences) {
    host.append(
      el("div", { className: "caveat" },
        "Consensus rewards the majority answer, so it cannot catch a mistake every model makes together. " +
        "Type reference transcripts for even 3–4 clips and hit Re-score for a real WER number.")
    );
  }
  host.append(
    el("div", { className: "caveat" },
      `Run at ${new Date(run.runAt).toLocaleString()} · language ${run.language} · ${run.clips.length} clips × ${run.models.length} models.`)
  );
}

function renderLeaderboard(run) {
  const t = $("#leaderboard");
  t.textContent = "";
  if (!run.leaderboard.length) return;
  const nameOf = (id) => run.models.find((m) => m.id === id) || { label: id, vendor: "" };

  const cols = run.hasReferences
    ? ["#", "Model", "Vendor", "Word accuracy", "WER", "CER", "Best on", "Avg latency", "Failed"]
    : ["#", "Model", "Vendor", "Agreement", "Best on", "Avg latency", "Words out", "Failed"];

  t.append(el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", { textContent: c })))));

  const body = el("tbody");
  run.leaderboard.forEach((r, i) => {
    const m = nameOf(r.modelId);
    const cells = run.hasReferences
      ? [
          el("td", { className: "rank", textContent: String(i + 1) }),
          el("td", { className: "model" }, m.label, m.baseline ? el("span", { className: "tag baseline", textContent: "prod" }) : ""),
          el("td", {}, el("span", { className: `tag ${m.vendor}`, textContent: m.vendor })),
          el("td", { className: "num" }, el("span", { className: `score ${scoreClass(r.avgWer)}`, textContent: pct(r.avgAccuracy) })),
          el("td", { className: "num", textContent: pct(r.avgWer) }),
          el("td", { className: "num", textContent: pct(r.avgCer) }),
          el("td", { className: "num", textContent: `${r.wins}/${run.clips.length}` }),
          el("td", { className: "num", textContent: r.avgMs == null ? "—" : `${r.avgMs} ms` }),
          el("td", { className: "num", textContent: r.failures ? `${r.failures}/${r.runs}` : "0" }),
        ]
      : [
          el("td", { className: "rank", textContent: String(i + 1) }),
          el("td", { className: "model" }, m.label, m.baseline ? el("span", { className: "tag baseline", textContent: "prod" }) : ""),
          el("td", {}, el("span", { className: `tag ${m.vendor}`, textContent: m.vendor })),
          el("td", { className: "num" }, el("span", { className: `score ${scoreClass(r.avgConsensus == null ? null : 1 - r.avgConsensus)}`, textContent: pct(r.avgConsensus) })),
          el("td", { className: "num", textContent: `${r.wins}/${run.clips.length}` }),
          el("td", { className: "num", textContent: r.avgMs == null ? "—" : `${r.avgMs} ms` }),
          el("td", { className: "num", textContent: String(r.wordsOut) }),
          el("td", { className: "num", textContent: r.failures ? `${r.failures}/${r.runs}` : "0" }),
        ];
    body.append(el("tr", { className: i === 0 ? "top" : "" }, ...cells));
  });
  t.append(body);
}

function renderMatrix(run) {
  const t = $("#matrix");
  t.textContent = "";

  t.append(
    el("thead", {}, el("tr", {},
      el("th", { textContent: "User / clip" }),
      ...run.models.map((m) =>
        el("th", { className: "modelcol" },
          m.label,
          el("br"),
          el("span", { className: `tag ${m.vendor}`, textContent: m.vendor }),
          m.baseline ? el("span", { className: "tag baseline", textContent: "prod" }) : ""
        )
      )
    ))
  );

  const body = el("tbody");
  for (const clip of run.clips) {
    const row = el("tr", {},
      el("td", { className: "userlabel" },
        clip.label,
        el("span", { className: "meta", textContent: clip.originalName }),
        el("span", { className: "meta", textContent: clip.reference ? "reference set" : "no reference" })
      )
    );

    for (const m of run.models) {
      const cell = run.cells[clip.id]?.[m.id] || null;
      const s = run.scored[clip.id]?.[m.id] || {};
      const td = el("td", { className: `cell ${cell?.ok === false ? "err" : ""} ${s.bestOnClip ? "best" : ""}` });
      td.dataset.clip = clip.id;
      td.dataset.model = m.id;

      // Mid-run placeholder: the cell is filled in by patchMatrixCell().
      if (!cell) {
        td.append(
          el("div", { className: "badge" }, m.label),
          el("div", { className: "txt", style: "color:var(--muted)", textContent: "waiting…" })
        );
        row.append(td);
        continue;
      }

      const badge = el("div", { className: "badge" }, m.label);
      if (cell.ok) {
        badge.append(` · ${cell.ms} ms`);
        if (typeof s.wer === "number") badge.append(el("span", { className: `score ${scoreClass(s.wer)}`, textContent: `WER ${pct(s.wer)}` }));
        else if (typeof s.consensus === "number") badge.append(el("span", { className: "score", textContent: `agree ${pct(s.consensus)}` }));
        if (s.bestOnClip) badge.append(el("span", { className: "score good", textContent: "best" }));
      }

      td.append(badge,
        el("div", { className: "txt", textContent: cell.ok ? (cell.text || "(empty transcript returned)") : (cell.error || "failed") })
      );
      td.addEventListener("click", () => openCell(run, clip, m));
      row.append(td);
    }
    body.append(row);
  }
  t.append(body);
}

/* ------------------------------------------------------------------ *
 * Cell detail modal (with word-level diff against the reference)
 * ------------------------------------------------------------------ */

async function openCell(run, clip, model) {
  const cell = run.cells[clip.id]?.[model.id] || {};
  const s = run.scored[clip.id]?.[model.id] || {};

  $("#modalTitle").textContent = `${clip.label} — ${model.label}`;
  $("#modalSub").textContent =
    `${model.vendor} · ${cell.ok ? `${cell.ms} ms` : "failed"}` +
    (typeof s.wer === "number" ? ` · WER ${pct(s.wer)} (${s.sub} sub / ${s.del} del / ${s.ins} ins of ${s.refWords} words)` : "") +
    (typeof s.consensus === "number" ? ` · ${pct(s.consensus)} agreement with the other models` : "");

  const body = $("#modalBody");
  body.textContent = "";
  body.append(el("audio", { controls: true, src: `/api/audio/${clip.id}`, style: "width:100%;margin-bottom:8px" }));

  if (!cell.ok) {
    body.append(el("h4", { textContent: "Error" }), el("div", { className: "transcript", textContent: cell.error }));
  } else {
    body.append(el("h4", { textContent: "Transcript" }), el("div", { className: "transcript", textContent: cell.text || "(empty)" }));

    if (clip.reference?.trim()) {
      const { tokens } = await (await fetch("/api/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: clip.reference, hypothesis: cell.text }),
      })).json();

      const diff = el("div", { className: "transcript diff" });
      for (const t of tokens) {
        const word = t.op === "del" ? t.ref : t.hyp;
        diff.append(el("span", { className: t.op, title: t.op === "sub" ? `reference: ${t.ref}` : t.op }, word), " ");
      }
      body.append(el("h4", { textContent: "Diff against reference" }), diff,
        el("div", { className: "legend" },
          el("span", { className: "diff" }, el("span", { className: "sub", textContent: "substituted" })),
          el("span", { className: "diff" }, el("span", { className: "ins", textContent: "inserted (model added it)" })),
          el("span", { className: "diff" }, el("span", { className: "del", textContent: "deleted (model missed it)" }))
        ),
        el("h4", { textContent: "Reference" }), el("div", { className: "transcript", textContent: clip.reference })
      );
    }

    // Same clip, every other model — the fastest way to eyeball a disagreement.
    body.append(el("h4", { textContent: "Same clip, other models" }));
    for (const m of run.models) {
      if (m.id === model.id) continue;
      const other = run.cells[clip.id]?.[m.id] || {};
      body.append(
        el("div", { className: "transcript", style: "margin-bottom:7px" },
          el("div", { className: "badge", style: "color:var(--muted);font-size:10.5px;font-family:var(--mono);margin-bottom:4px" },
            `${m.label} · ${m.vendor}${other.ok ? ` · ${other.ms} ms` : ""}`),
          other.ok ? (other.text || "(empty)") : `failed: ${other.error}`
        )
      );
    }
  }

  $("#modal").classList.remove("hidden");
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function wireEvents() {
  $("#selectEnabled").addEventListener("click", () => {
    state.providers.filter((p) => p.enabled).forEach((p) => state.selected.add(p.id));
    renderProviders(); updateEstimate();
  });
  $("#clearModels").addEventListener("click", () => {
    state.selected.clear(); renderProviders(); updateEstimate();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-body").forEach((b) => b.classList.toggle("hidden", b.id !== `tab-${tab.dataset.tab}`));
    });
  });

  const dz = $("#dropzone");
  $("#browseBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => uploadFiles([...e.target.files]));
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("hot"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("hot"); })
  );
  dz.addEventListener("drop", (e) => uploadFiles([...e.dataTransfer.files]));

  $("#fetchUrls").addEventListener("click", async () => {
    const urls = $("#urlInput").value
      .split("\n").map((l) => l.trim()).filter(Boolean)
      .map((line) => {
        const [url, label] = line.split("|").map((s) => s.trim());
        return { url, label: label || "" };
      });
    if (!urls.length) return;

    const status = $("#runStatus");
    status.classList.remove("hidden");
    status.textContent = `Fetching ${urls.length} URL(s)…`;

    const out = await (await fetch("/api/clips/from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    })).json();

    status.textContent = `Added ${out.added.length}${out.failed.length ? `, failed ${out.failed.length}: ${out.failed.map((f) => f.error).join("; ")}` : ""}`;
    if (out.added.length) $("#urlInput").value = "";
    await loadClips();
    updateEstimate();
  });

  $("#runBtn").addEventListener("click", runBenchmark);

  $("#rescoreBtn").addEventListener("click", async () => {
    const res = await fetch("/api/rescore", { method: "POST" });
    const run = await res.json();
    if (res.ok) renderResults(run);
  });

  $("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").classList.add("hidden"); });
}

boot();
