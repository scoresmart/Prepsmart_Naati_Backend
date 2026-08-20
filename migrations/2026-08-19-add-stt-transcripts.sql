-- Adds per-engine STT transcripts to segment_attempts so the score card can
-- show Azure / Google / Whisper output for the same user audio side by side.
--
-- Required because src/server.js calls sequelize.sync() WITHOUT { alter: true },
-- so adding the field to the model does not create the column.
--
-- Safe to run on a live table: adding a nullable JSON column with no default
-- does not rewrite existing rows. Existing attempts keep stt_transcripts = NULL
-- and the API reports them as available:false.

ALTER TABLE `segment_attempts`
  ADD COLUMN `stt_transcripts` JSON NULL
  AFTER `user_transcription`;

-- Verify:
--   SHOW COLUMNS FROM `segment_attempts` LIKE 'stt_transcripts';
--
-- Rollback:
--   ALTER TABLE `segment_attempts` DROP COLUMN `stt_transcripts`;
