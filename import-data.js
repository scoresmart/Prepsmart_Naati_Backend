/**
 * Import data from Supabase JSON export into MySQL
 * Audio URLs stored as-is (no S3 transfer). Migrate audio separately later.
 * Usage: node import-data.js
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sequelize } from "sequelize";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, "../../../exact-ui-clone/prepsmart-export-2026-02-22.json");

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST, dialect: "mysql", logging: false
});

const langMap = {};
const domainMap = {};
const dialogueMap = {};

function mapDiff(d) {
  if (!d) return "easy";
  const l = d.toLowerCase();
  if (l === "beginner" || l === "easy") return "easy";
  if (l === "intermediate" || l === "medium") return "medium";
  if (l === "advanced" || l === "hard") return "hard";
  return "easy";
}

async function main() {
  console.log("Reading JSON...");
  const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  console.log("  Languages:", data.languages.length, "Domains:", data.domains.length,
    "Dialogues:", data.dialogues.length, "Segments:", data.dialogue_segments.length,
    "Vocabulary:", data.vocabulary.length, "MockTests:", data.mock_tests ? data.mock_tests.length : 0);

  console.log("\nConnecting to MySQL...");
  await sequelize.authenticate();
  console.log("  Connected!\n");

  console.log("Cleaning up previous partial import data...");
  await sequelize.query("DELETE s FROM segments s JOIN dialogues d ON s.dialogue_id = d.id WHERE d.domain_id >= 45");
  await sequelize.query("DELETE mt FROM mockTest mt JOIN dialogues d ON mt.dialogue_id = d.id WHERE d.domain_id >= 45");
  await sequelize.query("DELETE FROM dialogues WHERE domain_id >= 45");
  await sequelize.query("DELETE FROM domains WHERE id >= 45");
  console.log("  Cleanup done.\n");

  // 1. Languages
  console.log("1. Importing languages...");
  for (const lang of data.languages) {
    await sequelize.query("INSERT INTO languages (name, lang_code, created_at, updated_at) VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), name=VALUES(name)", { replacements: [lang.name, lang.code] });
    const [[found]] = await sequelize.query("SELECT id FROM languages WHERE lang_code = ?", { replacements: [lang.code] });
    langMap[lang.id] = found.id;
    console.log("  " + lang.name + " (" + lang.code + ") -> ID " + found.id);
  }

  // 2. Domains
  console.log("\n2. Importing domains...");
  for (const dom of data.domains) {
    const langsUsed = [...new Set(data.dialogues.filter(d => d.domain_id === dom.id && d.language_id).map(d => d.language_id))];
    if (langsUsed.length === 0) langsUsed.push(data.languages[0].id);
    for (const oldLangId of langsUsed) {
      const newLangId = langMap[oldLangId];
      if (!newLangId) continue;
      const [[existing]] = await sequelize.query("SELECT id FROM domains WHERE title = ? AND language_id = ?", { replacements: [dom.title, newLangId] });
      let newDomainId;
      if (existing) {
        newDomainId = existing.id;
      } else {
        const [result] = await sequelize.query("INSERT INTO domains (title, description, difficulty, color_code, language_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", { replacements: [dom.title, dom.description || null, mapDiff(dom.difficulty), dom.color || null, newLangId] });
        newDomainId = result;
      }
      domainMap[dom.id + "__" + oldLangId] = newDomainId;
      console.log("  " + dom.title + " (lang " + newLangId + ") -> ID " + newDomainId);
    }
    if (!domainMap[dom.id]) {
      const firstKey = Object.keys(domainMap).find(k => k.startsWith(dom.id));
      if (firstKey) domainMap[dom.id] = domainMap[firstKey];
    }
  }

  // 3. Dialogues
  console.log("\n3. Importing dialogues...");
  let dlgImported = 0, dlgSkipped = 0;
  for (const dlg of data.dialogues) {
    const oldLangId = dlg.language_id || data.languages[0].id;
    const newLangId = langMap[oldLangId];
    const newDomainId = domainMap[dlg.domain_id + "__" + oldLangId] || domainMap[dlg.domain_id];
    if (!newDomainId || !newLangId) { dlgSkipped++; continue; }
    let durSec = 1200;
    if (dlg.duration) { const m = dlg.duration.match(/(\d+)/); if (m) durSec = parseInt(m[1]) * 60; }
    const [[existDlg]] = await sequelize.query("SELECT id FROM dialogues WHERE title = ? AND domain_id = ? AND language_id = ?", { replacements: [dlg.title, newDomainId, newLangId] });
    if (existDlg) { dialogueMap[dlg.id] = existDlg.id; } else {
      const [result] = await sequelize.query("INSERT INTO dialogues (domain_id, language_id, title, description, duration, difficulty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())", { replacements: [newDomainId, newLangId, dlg.title, dlg.description || null, durSec, mapDiff(dlg.difficulty)] });
      dialogueMap[dlg.id] = result;
    }
    dlgImported++;
  }
  console.log("  Imported: " + dlgImported + ", Skipped: " + dlgSkipped);

  // 4. Segments (NO audio transfer)
  console.log("\n4. Importing segments (audio URLs as-is)...");
  let segCount = 0;
  for (const seg of data.dialogue_segments) {
    const newDialogueId = dialogueMap[seg.dialogue_id];
    if (!newDialogueId) continue;
    await sequelize.query("INSERT INTO segments (dialogue_id, text_content, audio_url, segment_order, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE text_content = VALUES(text_content), audio_url = VALUES(audio_url)", { replacements: [newDialogueId, seg.text_content || "", seg.audio_url || null, seg.segment_order] });
    segCount++;
    if (segCount % 200 === 0) console.log("  ... " + segCount + "/" + data.dialogue_segments.length);
  }
  console.log("  Done: " + segCount + " segments");

  // 5. Vocabulary (NO audio transfer)
  console.log("\n5. Importing vocabulary...");
  let vocabCount = 0;
  for (const v of data.vocabulary) {
    const newLangId = langMap[v.language_id] || null;
    let originalWord = v.word || "";
    let convertedWord = "";
    if (v.word && v.word.indexOf("\u2192") !== -1) {
      const parts = v.word.split("\u2192").map(s => s.trim());
      originalWord = parts[0];
      convertedWord = parts[1] || "";
    }
    let origAudio = null, convAudio = null;
    if (v.audio_url) {
      const parts = v.audio_url.split("|");
      origAudio = (parts[0] || "").trim() || null;
      convAudio = (parts[1] || "").trim() || null;
    }
    const [[existVocab]] = await sequelize.query("SELECT id FROM vocabulary WHERE original_word = ? AND language_id = ?", { replacements: [originalWord, newLangId] });
    if (!existVocab) {
      await sequelize.query("INSERT INTO vocabulary (language_id, original_word, converted_word, original_audio_url, converted_audio_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())", { replacements: [newLangId, originalWord, convertedWord, origAudio, convAudio, v.definition || null] });
    }
    vocabCount++;
    if (vocabCount % 200 === 0) console.log("  ... " + vocabCount + "/" + data.vocabulary.length);
  }
  console.log("  Done: " + vocabCount + " vocabulary items");

  // 6. Mock Tests
  if (data.mock_tests && data.mock_tests.length > 0) {
    console.log("\n6. Importing mock tests...");
    for (const mt of data.mock_tests) {
      const newLangId = langMap[mt.language_id];
      const newDlg1 = dialogueMap[mt.dialogue1_id];
      const newDlg2 = dialogueMap[mt.dialogue2_id] || null;
      if (!newLangId || !newDlg1) { console.warn("  SKIP: " + mt.title); continue; }
      const [[existMt]] = await sequelize.query("SELECT id FROM mockTest WHERE title = ? AND language_id = ?", { replacements: [mt.title, newLangId] });
      if (!existMt) {
        await sequelize.query("INSERT INTO mockTest (title, language_id, dialogue_id, dialogue_id_2, duration_seconds, total_marks, pass_marks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 90, 63, NOW(), NOW())", { replacements: [mt.title, newLangId, newDlg1, newDlg2, (mt.time_limit_minutes || 20) * 60] });
        console.log("  Imported: " + mt.title);
      } else { console.log("  Already exists: " + mt.title); }
    }
  }

  console.log("\n=== IMPORT COMPLETE ===");
  console.log("  Languages:", Object.keys(langMap).length);
  console.log("  Domains:", new Set(Object.values(domainMap)).size);
  console.log("  Dialogues:", Object.keys(dialogueMap).length);
  console.log("  Segments:", segCount);
  console.log("  Vocabulary:", vocabCount);
  console.log("\nAudio URLs stored as original Supabase paths. Migrate audio separately.");
  await sequelize.close();
  process.exit(0);
}

main().catch(err => { console.error("IMPORT FAILED:", err); process.exit(1); });
