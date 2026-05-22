import fs from "fs/promises";
import path from "path";
import pool from "./pool.js";

export async function restoreDatabaseFromJson(inputFilePath = path.join(import.meta.dirname, "db_export.json")) {
  const client = await pool.connect();
  try {
    console.log(`Reading restore payload from: ${inputFilePath}`);
    const fileContent = await fs.readFile(inputFilePath, "utf-8");
    const decksList = JSON.parse(fileContent);

    // Clear only decks/cards/choices — users table is untouched, passwords preserved
    console.log("Clearing decks, cards and choices (users preserved)...");
    await client.query("BEGIN");
    await client.query("DELETE FROM card_choices");
    await client.query("DELETE FROM cards");
    await client.query("DELETE FROM decks");

    console.log(`Restoring ${decksList.length} decks...`);

    // Cache username→id lookups to avoid repeated queries
    const userIdCache = {};

    for (const deck of decksList) {
      // Resolve user_id: use stored userId if it exists, else look up by username
      let userId = deck.userId;
      if (deck.username && !userIdCache[deck.username]) {
        const r = await client.query(`SELECT id FROM users WHERE username = $1`, [deck.username]);
        if (r.rows.length) userIdCache[deck.username] = r.rows[0].id;
      }
      if (deck.username && userIdCache[deck.username]) userId = userIdCache[deck.username];

      if (!userId) {
        console.warn(`Skipping deck "${deck.title}" — no matching user found for userId=${deck.userId} username=${deck.username}`);
        continue;
      }

      await client.query(
        `INSERT INTO decks (id, user_id, title, category, creation_time) VALUES ($1, $2, $3, $4, $5)`,
        [deck.deckId, userId, deck.title, deck.category, deck.creationTime || new Date()]
      );

      if (Array.isArray(deck.cards)) {
        for (const [idx, card] of deck.cards.entries()) {
          // Normalize true_false (legacy type) to multiple_choice
          const cardType = card.cardType === 'true_false' ? 'multiple_choice' : (card.cardType || 'basic');
          const position = card.position ?? idx;
          await client.query(
            `INSERT INTO cards (id, deck_id, question, answer, card_type, position, creation_time) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [card.cardId, deck.deckId, card.question, card.answer, cardType, position, card.creationTime || new Date()]
          );

          if (cardType === "multiple_choice" && Array.isArray(card.choices)) {
            for (const choice of card.choices) {
              await client.query(
                `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
                [choice.choiceId, card.cardId, choice.choiceText, !!choice.isCorrect]
              );
            }
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log("Database successfully restored! Users and passwords were not affected.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Restoration failed, rolled back:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] === import.meta.filename) {
  restoreDatabaseFromJson().then(() => pool.end()).catch(() => process.exit(1));
}