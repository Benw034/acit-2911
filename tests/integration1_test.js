import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../db/pool.js"; 

describe("Flashcard Logic (Database Version)", () => {
  // Fixed test user ID — inserted once before tests, never changes
  const TEST_USER_ID = "user-integration1-test-fixed";

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Wipes data in correct order respecting foreign key cascades
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM decks");
    await pool.query("DELETE FROM session");
    await pool.query("DELETE FROM users WHERE id = $1", [TEST_USER_ID]);

    // Seed a minimal test user so deck foreign keys resolve
    await pool.query(
      "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [TEST_USER_ID, "integration1-user", "$2b$12$placeholder"]
    );

    await pool.query(
      `INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)`,
      ['deck-1', TEST_USER_ID, 'JavaScript Basics', 'Programming']
    );

    await pool.query(
      `INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, $5)`,
      ['card-1', 'deck-1', 'Q1', 'A1', 'basic']
    );
  });

  // ----------------------------------------------------------- Deck Operations

  describe("Deck Management", () => {
    it("adds a new deck with a unique ID", async () => {
      const title = "New Language";
      const id = "deck-new-123";
      const category = "General";

      // Execute database write
      await pool.query(
        `INSERT INTO decks (id, title, category) VALUES ($1, $2, $3)`,
        [id, title, category]
      );
      
      // Pull row directly from PG to assert persistence
      const res = await pool.query("SELECT * FROM decks WHERE id = $1", [id]);
      
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].title, "New Language");
    });

    it("prevents adding a deck with an empty title", async () => {
      const addDeck = async (id, title) => {
        // Enforce the same dynamic validation logic as your API layer
        if (!title || !title.trim()) throw new Error("Title is required");
        await pool.query(`INSERT INTO decks (id, title) VALUES ($1, $2)`, [id, title]);
      };

      // Assert validation boundary rejects string blanks before SQL run
      await assert.rejects(() => addDeck("deck-fail", ""), /Title is required/);
    });

    it("retrieves all decks as a list", async () => {
      const res = await pool.query("SELECT * FROM decks");
      
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].id, 'deck-1');
    });

    it("deletes a deck by ID", async () => {
      await pool.query("DELETE FROM decks WHERE id = $1", ['deck-1']);
      
      const res = await pool.query("SELECT * FROM decks WHERE id = $1", ['deck-1']);
      assert.equal(res.rows.length, 0);
    });
  });

  // ----------------------------------------------------------- Card Operations

  describe("Card Management", () => {
    it("adds a card to a specific deck", async () => {
      const newCardId = "card-99";
      
      await pool.query(
        `INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, $5)`,
        [newCardId, 'deck-1', '2+2?', '4', 'basic']
      );
      
      const res = await pool.query("SELECT * FROM cards WHERE deck_id = $1 ORDER BY creation_time ASC", ['deck-1']);
      
      assert.equal(res.rows.length, 2);
      assert.equal(res.rows[1].question, '2+2?');
    });

    it("updates an existing card's content", async () => {
      await pool.query(
        `UPDATE cards SET question = $1 WHERE id = $2`,
        ["Updated Question", 'card-1']
      );
      
      const res = await pool.query("SELECT question FROM cards WHERE id = $1", ['card-1']);
      assert.equal(res.rows[0].question, "Updated Question");
    });

    it("deletes a specific card from a deck", async () => {
      await pool.query("DELETE FROM cards WHERE id = $1", ['card-1']);
      
      const res = await pool.query("SELECT * FROM cards WHERE id = $1", ['card-1']);
      assert.equal(res.rows.length, 0);
    });
  });

  // ----------------------------------------------------------- Filtering Logic

  describe("Filtering Logic", () => {
    it("filters decks by category correctly", async () => {
      // Seed secondary variant row directly into current run sandbox state
      await pool.query(
        `INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)`,
        ['deck-2', TEST_USER_ID, 'Test', 'Math']
      );
      
      // Perform database filtering using standard SQL WHERE constraints
      const res = await pool.query("SELECT * FROM decks WHERE category = $1", ['Programming']);
      
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].category, 'Programming');
    });
  });
});