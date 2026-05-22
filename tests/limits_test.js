import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import app from "../server.js";
import pool from "../db/pool.js";
import { createAuthedAgent, cleanupTestUsers } from "./helpers.js";

const LIMITS = { deckTitle: 50, deckCategory: 20, question: 200, answer: 200, choiceText: 100 };
const str = (n, ch = "a") => ch.repeat(n);

describe("Field Length Limits", () => {
  let agent, deckId;

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM decks");
    await cleanupTestUsers();

    ({ agent } = await createAuthedAgent(app));

    const res = await agent
      .post("/api/decks")
      .send({ title: "Limit Test Deck", category: "testing" })
      .expect(201);
    deckId = res.body.id;
  });

  // ── Deck title ────────────────────────────────────────────────────────────

  describe("Deck title — POST /api/decks", () => {
    it("accepts a title exactly at the 50-char limit", async () => {
      const title = str(LIMITS.deckTitle);
      const res = await agent.post("/api/decks").send({ title }).expect(201);
      assert.equal(res.body.title, title);
    });

    it("truncates a title that exceeds 50 chars", async () => {
      const res = await agent
        .post("/api/decks")
        .send({ title: str(LIMITS.deckTitle + 50) })
        .expect(201);
      assert.equal(res.body.title.length, LIMITS.deckTitle);
    });
  });

  describe("Deck title — PUT /api/decks/:id", () => {
    it("truncates an over-limit title on update", async () => {
      const res = await agent
        .put(`/api/decks/${deckId}`)
        .send({ title: str(LIMITS.deckTitle + 50), category: "test" })
        .expect(200);
      assert.equal(res.body.title.length, LIMITS.deckTitle);
    });
  });

  // ── Deck category ─────────────────────────────────────────────────────────

  describe("Deck category — POST /api/decks", () => {
    it("accepts a category exactly at the 20-char limit", async () => {
      const category = str(LIMITS.deckCategory);
      const res = await agent
        .post("/api/decks")
        .send({ title: "Cat Test", category })
        .expect(201);
      assert.equal(res.body.category, category);
    });

    it("truncates a category that exceeds 20 chars", async () => {
      const res = await agent
        .post("/api/decks")
        .send({ title: "Cat Test", category: str(LIMITS.deckCategory + 30) })
        .expect(201);
      assert.equal(res.body.category.length, LIMITS.deckCategory);
    });
  });

  describe("Deck category — PUT /api/decks/:id", () => {
    it("truncates an over-limit category on update", async () => {
      const res = await agent
        .put(`/api/decks/${deckId}`)
        .send({ title: "Cat Update", category: str(LIMITS.deckCategory + 30) })
        .expect(200);
      assert.equal(res.body.category.length, LIMITS.deckCategory);
    });
  });

  // ── Card question & answer — single card POST ─────────────────────────────

  describe("Card question/answer — POST /api/decks/:id/cards", () => {
    it("accepts question and answer each exactly at 200 chars", async () => {
      const q = str(LIMITS.question);
      const a = str(LIMITS.answer);
      const res = await agent
        .post(`/api/decks/${deckId}/cards`)
        .send({ question: q, answer: a })
        .expect(201);
      assert.equal(res.body.question, q);
      assert.equal(res.body.answer, a);
    });

    it("truncates question exceeding 200 chars", async () => {
      const res = await agent
        .post(`/api/decks/${deckId}/cards`)
        .send({ question: str(LIMITS.question + 100), answer: "answer" })
        .expect(201);
      assert.equal(res.body.question.length, LIMITS.question);

      const db = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(db.rows[0].question.length, LIMITS.question);
    });

    it("truncates answer exceeding 200 chars", async () => {
      const res = await agent
        .post(`/api/decks/${deckId}/cards`)
        .send({ question: "question", answer: str(LIMITS.answer + 100) })
        .expect(201);
      assert.equal(res.body.answer.length, LIMITS.answer);

      const db = await pool.query("SELECT answer FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(db.rows[0].answer.length, LIMITS.answer);
    });
  });

  // ── MCQ choice text — single card POST ───────────────────────────────────

  describe("MCQ choice text — POST /api/decks/:id/cards", () => {
    it("accepts a choice exactly at 100 chars", async () => {
      const choiceText = str(LIMITS.choiceText);
      const res = await agent
        .post(`/api/decks/${deckId}/cards`)
        .send({
          question: "q",
          answer: choiceText,
          card_type: "multiple_choice",
          choices: [{ choiceText, isCorrect: true }],
        })
        .expect(201);
      assert.equal(res.body.choices[0].choiceText, choiceText);
    });

    it("truncates a choice exceeding 100 chars", async () => {
      const longChoice = str(LIMITS.choiceText + 50);
      const res = await agent
        .post(`/api/decks/${deckId}/cards`)
        .send({
          question: "q",
          answer: "answer",
          card_type: "multiple_choice",
          choices: [{ choiceText: longChoice, isCorrect: true }],
        })
        .expect(201);
      assert.equal(res.body.choices[0].choiceText.length, LIMITS.choiceText);

      const db = await pool.query(
        "SELECT choice_text FROM card_choices WHERE card_id = $1",
        [res.body.id]
      );
      assert.equal(db.rows[0].choice_text.length, LIMITS.choiceText);
    });
  });

  // ── Bulk card endpoint ─────────────────────────────────────────────────────

  describe("Bulk card save — PUT /api/decks/:id/cards/bulk", () => {
    it("truncates question, answer, and choice text that exceed limits", async () => {
      const res = await agent
        .put(`/api/decks/${deckId}/cards/bulk`)
        .send({
          cards: [
            {
              question:  str(LIMITS.question  + 100),
              answer:    str(LIMITS.answer    + 100),
              card_type: "multiple_choice",
              choices:   [{ choiceText: str(LIMITS.choiceText + 50), isCorrect: true }],
            },
          ],
        })
        .expect(200);

      assert.equal(res.body.success, true);

      const cards = await pool.query(
        "SELECT question, answer FROM cards WHERE deck_id = $1",
        [deckId]
      );
      assert.equal(cards.rows[0].question.length, LIMITS.question);
      assert.equal(cards.rows[0].answer.length,   LIMITS.answer);

      const choices = await pool.query(
        "SELECT choice_text FROM card_choices cc JOIN cards c ON cc.card_id = c.id WHERE c.deck_id = $1",
        [deckId]
      );
      assert.equal(choices.rows[0].choice_text.length, LIMITS.choiceText);
    });

    it("accepts bulk cards with fields exactly at their limits", async () => {
      const res = await agent
        .put(`/api/decks/${deckId}/cards/bulk`)
        .send({
          cards: [
            {
              question:  str(LIMITS.question),
              answer:    str(LIMITS.answer),
              card_type: "multiple_choice",
              choices:   [{ choiceText: str(LIMITS.choiceText), isCorrect: true }],
            },
          ],
        })
        .expect(200);

      assert.equal(res.body.success, true);

      const cards = await pool.query(
        "SELECT question, answer FROM cards WHERE deck_id = $1",
        [deckId]
      );
      assert.equal(cards.rows[0].question.length, LIMITS.question);
      assert.equal(cards.rows[0].answer.length,   LIMITS.answer);
    });
  });

  // ── CSV parse endpoint ─────────────────────────────────────────────────────

  describe("CSV parse — POST /api/import/csv/parse", () => {
    it("truncates question and answer fields that exceed limits", async () => {
      const longQ = str(LIMITS.question + 100);
      const longA = str(LIMITS.answer   + 100);
      const csv = `question,answer,card_type\n${longQ},${longA},basic`;
      const buf = Buffer.from(csv, "utf-8");

      const res = await agent
        .post("/api/import/csv/parse")
        .attach("file", buf, { filename: "test.csv", contentType: "text/csv" })
        .expect(200);

      assert.equal(res.body.rows[0].question.length, LIMITS.question);
      assert.equal(res.body.rows[0].answer.length,   LIMITS.answer);
    });

    it("truncates MCQ choice text that exceeds 100 chars", async () => {
      const longChoice = str(LIMITS.choiceText + 50);
      const csv = `question,answer,card_type,choices\nWhat?,correct,multiple_choice,${longChoice}|short`;
      const buf = Buffer.from(csv, "utf-8");

      const res = await agent
        .post("/api/import/csv/parse")
        .attach("file", buf, { filename: "test.csv", contentType: "text/csv" })
        .expect(200);

      const choices = res.body.rows[0].choices;
      assert.ok(choices.every(c => c.choiceText.length <= LIMITS.choiceText));
    });

    it("accepts fields exactly at the limit without truncation", async () => {
      const q = str(LIMITS.question);
      const a = str(LIMITS.answer);
      const csv = `question,answer,card_type\n${q},${a},basic`;
      const buf = Buffer.from(csv, "utf-8");

      const res = await agent
        .post("/api/import/csv/parse")
        .attach("file", buf, { filename: "test.csv", contentType: "text/csv" })
        .expect(200);

      assert.equal(res.body.rows[0].question, q);
      assert.equal(res.body.rows[0].answer,   a);
    });
  });
});
