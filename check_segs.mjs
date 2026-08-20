import Sequelize from 'sequelize';
const s = new Sequelize.Sequelize('naati','admin','naatiPassword123',{host:'naati.c3aee242wqkd.ap-southeast-2.rds.amazonaws.com',dialect:'mysql',logging:false});

const [segs] = await s.query("SELECT id, segment_order, suggested_audio_url FROM segments WHERE suggested_audio_url IS NOT NULL LIMIT 5");
console.log("Segments with suggested_audio_url:", segs.length);
segs.forEach(r => console.log("id:", r.id, "order:", r.segment_order));

const [segs2] = await s.query("SELECT id, segment_order, translation FROM segments WHERE translation IS NOT NULL AND translation != '' LIMIT 5");
console.log("Segments with translation:", segs2.length);
segs2.forEach(r => console.log("id:", r.id, "order:", r.segment_order, "trans:", String(r.translation).substring(0, 60)));

// Check how GPT prompt looks for segment 929
const [sa] = await s.query("SELECT id, segment_id, ai_scores FROM segment_attempts WHERE id = 189");
if (sa[0]) {
  const j = typeof sa[0].ai_scores === 'string' ? JSON.parse(sa[0].ai_scores) : sa[0].ai_scores;
  console.log("\n--- ai_scores for attempt 189 (seg 929) ---");
  console.log("rawScore:", j.rawScore, "totalPenalties:", j.totalPenalties, "finalScore:", j.finalScore);
  console.log("Omissions:", JSON.stringify(j.analysis?.omissions));
  console.log("Distortions:", JSON.stringify(j.analysis?.distortions));
}

await s.close();
