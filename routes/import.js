import { Router } from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs/promises";
import crypto from "crypto";
import DOMPurify from "isomorphic-dompurify";
import pool from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const PURIFY_OPTS = { FORBID_TAGS: ["style", "script", "iframe"] };

// Store uploads in OS temp dir, cleaned up after processing
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("Only .csv files are allowed"));
    }
    cb(null, true);
  },
});

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * POST /api/import/csv
 * Multipart upload — field name: "file"
 * Parses the CSV and inserts cards into the logged-in user's account.
 * Returns { imported, skipped, decksCreated, errors[] }
 */
router.post("/csv", requireAuth, upload.single("file"), async (req, res) => {
  const tmpPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded" });
    }

    const fileContent = await fs.readFile(tmpPath, "utf-8");
    const lines = fileContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length <= 1) {
      return res.status(400).json({ error: "CSV is empty or has no data rows" });
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const idx = {
      deckTitle:    headers.indexOf("deck_title"),
      deckCategory: headers.indexOf("deck_category"),
      cardType:     headers.indexOf("card_type"),
      question:     headers.indexOf("question"),
      answer:       headers.indexOf("answer"),
      choices:      headers.indexOf("choices"),
    };

    const required = ["deck_title", "question", "answer"];
    const missing = required.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required columns: ${missing.join(", ")}`,
        hint: 'Required headers: deck_title, question, answer. Optional: deck_category, card_type, choices',
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const deckCache = new Map();
      let imported = 0;
      let skipped = 0;
      let decksCreated = 0;
      const errors = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const row = parseCsvLine(lines[i]);
          if (row.length < 3) { skipped++; continue; }

          const rawDeckTitle    = row[idx.deckTitle]    ?? "";
          const rawCategory     = idx.deckCategory !== -1 ? (row[idx.deckCategory] ?? "General") : "General";
          const rawCardType     = idx.cardType     !== -1 ? (row[idx.cardType]     ?? "basic")   : "basic";
          const rawQuestion     = row[idx.question] ?? "";
          const rawAnswer       = row[idx.answer]   ?? "";
          const rawChoices      = idx.choices       !== -1 ? (row[idx.choices]     ?? "")        : "";

          if (!rawDeckTitle.trim() || !rawQuestion.trim() || !rawAnswer.trim()) {
            skipped++;
            continue;
          }

          const cleanDeckTitle = DOMPurify.sanitize(rawDeckTitle.trim(), PURIFY_OPTS);
          const cleanCategory  = DOMPurify.sanitize(rawCategory.trim(),  PURIFY_OPTS);
          const cleanQuestion  = DOMPurify.sanitize(rawQuestion.trim(),  PURIFY_OPTS);
          const cleanAnswer    = DOMPurify.sanitize(rawAnswer.trim(),    PURIFY_OPTS);
          const cleanCardType  = ["basic", "multiple_choice", "true_false"].includes(rawCardType.trim())
            ? rawCardType.trim() : "basic";

          // Resolve or create deck
          let deckId = deckCache.get(cleanDeckTitle);
          if (!deckId) {
            const existing = await client.query(
              "SELECT id FROM decks WHERE user_id = $1 AND title = $2",
              [req.session.userId, cleanDeckTitle]
            );
            if (existing.rows.length > 0) {
              deckId = existing.rows[0].id;
            } else {
              deckId = "deck-" + crypto.randomUUID();
              await client.query(
                "INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)",
                [deckId, req.session.userId, cleanDeckTitle, cleanCategory]
              );
              decksCreated++;
            }
            deckCache.set(cleanDeckTitle, deckId);
          }

          // Insert card
          const cardId = "card-" + crypto.randomUUID();
          await client.query(
            "INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, $5)",
            [cardId, deckId, cleanQuestion, cleanAnswer, cleanCardType]
          );

          // Insert choices for multiple_choice cards
          if (cleanCardType === "multiple_choice" && rawChoices.trim()) {
            const choiceList = rawChoices.split("|").map((c) => c.trim()).filter(Boolean);
            for (const choiceText of choiceList) {
              const cleanChoice = DOMPurify.sanitize(choiceText, PURIFY_OPTS);
              const isCorrect = cleanChoice.toLowerCase() === cleanAnswer.toLowerCase();
              await client.query(
                "INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)",
                ["choice-" + crypto.randomUUID(), cardId, cleanChoice, isCorrect]
              );
            }
          }

          imported++;
        } catch (rowErr) {
          errors.push(`Row ${i + 1}: ${rowErr.message}`);
          skipped++;
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        imported,
        skipped,
        decksCreated,
        errors: errors.slice(0, 10), // cap error list
        message: `Imported ${imported} card${imported !== 1 ? "s" : ""} across ${decksCreated} new deck${decksCreated !== 1 ? "s" : ""}.`,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("CSV import error:", err);
    res.status(500).json({ error: err.message || "Import failed" });
  } finally {
    // Always clean up the temp file
    if (tmpPath) fs.unlink(tmpPath).catch(() => {});
  }
});

export default router;
