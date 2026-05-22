import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js";
import pool from "../db/pool.js"; 
import { createAuthedAgent, cleanupTestUsers } from "./helpers.js";

describe("API Endpoint Integration Suite", () => {
  let agent, userId;

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM decks");
    await cleanupTestUsers();

    ({ agent, userId } = await createAuthedAgent(app));

    await pool.query(
      "INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)",
      ["deck-integration-1", userId, "API Test Deck", "Testing"]
    );
  });

  describe("POST /api/decks/:deckId/cards", () => {
    it("should process a multi-choice card payload, save it to the DB, and return it with aggregate choices", async () => {
      const complexPayload = {
        question: "What is the capital of Canada?",
        answer: "Ottawa",
        card_type: "multiple_choice",
        choices: [
          { choiceText: "Ottawa", isCorrect: true },
          { choiceText: "Vancouver", isCorrect: false }
        ]
      };

      const res = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send(complexPayload)
        .expect("Content-Type", /json/)
        .expect(201);

      const correctChoice = res.body.choices.find(c => c.isCorrect === true);

      console.log('DEBUG RESPONSE BODY:', JSON.stringify(res.body, null, 2));
      assert.match(res.body.id, /^card-/);
      assert.equal(res.body.cardType, "multiple_choice");
      assert.equal(res.body.choices.length, 2);
      assert.ok(correctChoice, 'Should have found a correct choice');
      assert.strictEqual(correctChoice.choiceText, 'Ottawa');

      const dbCard = await pool.query("SELECT * FROM cards WHERE id = $1", [res.body.id]);
      const dbChoices = await pool.query("SELECT * FROM card_choices WHERE card_id = $1", [res.body.id]);

      assert.equal(dbCard.rows.length, 1);
      assert.equal(dbChoices.rows.length, 2);
    });

    it("should enforce input sanitization and save scrubbed strings to the database", async () => {
      const dirtyPayload = {
        question: "Hello <script>alert('xss')</script>World",
        answer: "Safe Answer <iframe src='malicious.site'></iframe>"
      };

      const res = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send(dirtyPayload)
        .expect(201);

      assert.equal(res.body.question, "Hello World");
      assert.equal(res.body.answer, "Safe Answer ");

      const dbCheck = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question, "Hello World");
    });
  });

  describe("GET /api/decks/:deckId", () => {
    it("returns 404 for unknown deck id", async () => {
      const res = await agent
        .get("/api/decks/deck-does-not-exist")
        .expect(404);
      assert.deepEqual(res.body, { error: "deck not found" });
    });

    it("returns deck with cards and choices attached", async () => {
      // Create an MCQ card
      const cardRes = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({
          question: "Capital of France?",
          answer: "Paris",
          card_type: "multiple_choice",
          choices: [
            { choiceText: "Paris", isCorrect: true },
            { choiceText: "London", isCorrect: false },
            { choiceText: "Berlin", isCorrect: false }
          ]
        })
        .expect(201);

      // Fetch the deck and verify choices are nested correctly
      const deckRes = await agent
        .get("/api/decks/deck-integration-1")
        .expect(200);

      const card = deckRes.body.cards.find(c => c.id === cardRes.body.id);
      assert.ok(card, "Card should be present in deck response");
      assert.equal(card.cardType, "multiple_choice");
      assert.equal(card.choices.length, 3);

      const correct = card.choices.find(c => c.isCorrect);
      assert.ok(correct, "Should have a correct choice");
      assert.equal(correct.choiceText, "Paris");

      // Verify shape — camelCase fields
      assert.ok("choiceText" in card.choices[0], "choices should have choiceText");
      assert.ok("isCorrect" in card.choices[0], "choices should have isCorrect");
    });
  });

  describe("PUT /api/decks/:deckId/cards/:cardId", () => {
    it("updates a basic card's question and answer", async () => {
      const created = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({ question: "Original Q", answer: "Original A" })
        .expect(201);

      const updated = await agent
        .put(`/api/decks/deck-integration-1/cards/${created.body.id}`)
        .send({ question: "Updated Q", answer: "Updated A", card_type: "basic", choices: [] })
        .expect(200);

      assert.equal(updated.body.question, "Updated Q");
      assert.equal(updated.body.answer, "Updated A");

      // Verify in DB
      const dbCheck = await pool.query(
        "SELECT question, answer FROM cards WHERE id = $1",
        [created.body.id]
      );
      assert.equal(dbCheck.rows[0].question, "Updated Q");
      assert.equal(dbCheck.rows[0].answer, "Updated A");
    });

    it("updates an MCQ card and replaces choices", async () => {
      const created = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({
          question: "Original MCQ?",
          answer: "A",
          card_type: "multiple_choice",
          choices: [
            { choiceText: "A", isCorrect: true },
            { choiceText: "B", isCorrect: false }
          ]
        })
        .expect(201);

      const updated = await agent
        .put(`/api/decks/deck-integration-1/cards/${created.body.id}`)
        .send({
          question: "Updated MCQ?",
          answer: "C",
          card_type: "multiple_choice",
          choices: [
            { choiceText: "C", isCorrect: true },
            { choiceText: "D", isCorrect: false },
            { choiceText: "E", isCorrect: false }
          ]
        })
        .expect(200);

      assert.equal(updated.body.question, "Updated MCQ?");
      assert.equal(updated.body.choices.length, 3);
      assert.equal(updated.body.choices.find(c => c.isCorrect).choiceText, "C");

      // Old choices should be gone
      const dbChoices = await pool.query(
        "SELECT COUNT(*)::int FROM card_choices WHERE card_id = $1",
        [created.body.id]
      );
      assert.equal(dbChoices.rows[0].count, 3);
    });

    it("returns 404 for unknown card id", async () => {
      await agent
        .put("/api/decks/deck-integration-1/cards/card-does-not-exist")
        .send({ question: "Q", answer: "A", card_type: "basic", choices: [] })
        .expect(404);
    });
  });

  describe("DELETE /api/decks/:deckId/cards/:cardId", () => {
    it("deletes a card and cascades to its choices", async () => {
      const created = await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({
          question: "To be deleted",
          answer: "Gone",
          card_type: "multiple_choice",
          choices: [
            { choiceText: "X", isCorrect: true },
            { choiceText: "Y", isCorrect: false }
          ]
        })
        .expect(201);

      const cardId = created.body.id;

      await agent
        .delete(`/api/decks/deck-integration-1/cards/${cardId}`)
        .expect(200);

      // Card should be gone
      const cardCheck = await pool.query(
        "SELECT id FROM cards WHERE id = $1", [cardId]
      );
      assert.equal(cardCheck.rows.length, 0);

      // Choices should be cascade-deleted
      const choiceCheck = await pool.query(
        "SELECT COUNT(*)::int FROM card_choices WHERE card_id = $1", [cardId]
      );
      assert.equal(choiceCheck.rows[0].count, 0);
    });

    it("returns 404 for unknown card", async () => {
      await agent
        .delete("/api/decks/deck-integration-1/cards/card-does-not-exist")
        .expect(404);
    });
  });

  describe("Card route 404s on nonexistent deck", () => {
    it("POST card to nonexistent deck returns 404", async () => {
      await agent
        .post("/api/decks/deck-does-not-exist/cards")
        .send({ question: "Q", answer: "A" })
        .expect(404);
    });

    it("PUT card on nonexistent deck returns 404", async () => {
      await agent
        .put("/api/decks/deck-does-not-exist/cards/card-does-not-exist")
        .send({ question: "Q", answer: "A", card_type: "basic", choices: [] })
        .expect(404);
    });

    it("DELETE card on nonexistent deck returns 404", async () => {
      await agent
        .delete("/api/decks/deck-does-not-exist/cards/card-does-not-exist")
        .expect(404);
    });
  });

  describe("GET /api/decks — category data", () => {
    it("returns decks with category populated", async () => {
      await agent
        .put("/api/decks/deck-integration-1")
        .send({ title: "API Test Deck", category: "science, history" })
        .expect(200);

      const res = await agent.get("/api/decks").expect(200);
      const deck = res.body.find(d => d.id === "deck-integration-1");
      assert.ok(deck, "Deck should be in list");
      assert.equal(deck.category, "science, history");
    });

    it("returns cardCount for each deck", async () => {
      await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({ question: "Q1", answer: "A1" })
        .expect(201);
      await agent
        .post("/api/decks/deck-integration-1/cards")
        .send({ question: "Q2", answer: "A2" })
        .expect(201);

      const res = await agent.get("/api/decks").expect(200);
      const deck = res.body.find(d => d.id === "deck-integration-1");
      assert.equal(deck.cardCount, 2);
    });
  });
});