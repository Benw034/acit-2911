import fs from "fs/promises";
import path from "path";
import pool from "./pool.js";

// Dynamically target the exact folder where export.js sits
export async function exportDatabaseToJson(outputFilePath = path.join(import.meta.dirname, "db_export.json")) {
  try {
    console.log("Exporting decks and cards (users table excluded)...");

    // Export decks grouped by user_id — no user data, no password hashes
    const query = `
      SELECT
        d.id AS "deckId", d.user_id AS "userId", u.username AS "username",
        d.title, d.category, d.creation_time AS "creationTime",
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'cardId', card_sub.id,
              'question', card_sub.question,
              'answer', card_sub.answer,
              'cardType', card_sub.card_type,
              'position', card_sub.position,
              'creationTime', card_sub.creation_time,
              'choices', COALESCE(
                (SELECT json_agg(json_build_object(
                  'choiceId', cc.id,
                  'choiceText', cc.choice_text,
                  'isCorrect', cc.is_correct
                )) FROM card_choices cc WHERE cc.card_id = card_sub.id),
                '[]'::json
              )
            )
            ORDER BY card_sub.position ASC
          ) FROM cards card_sub WHERE card_sub.deck_id = d.id),
          '[]'::json
        ) AS cards
      FROM decks d
      JOIN users u ON u.id = d.user_id
      ORDER BY d.creation_time ASC;
    `;

    const result = await pool.query(query);
    await fs.writeFile(outputFilePath, JSON.stringify(result.rows, null, 2), "utf-8");

    console.log(`Export complete — ${result.rows.length} decks saved to: ${outputFilePath}`);
    return result.rows;
  } catch (error) {
    console.error("Export failed:", error);
    throw error;
  }
}

if (process.argv[1] === import.meta.filename) {
  exportDatabaseToJson().then(() => pool.end()).catch(() => process.exit(1));
}