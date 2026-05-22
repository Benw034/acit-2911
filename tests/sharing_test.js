import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { cleanupTestUsers } from "./helpers.js";

async function makeUser(username) {
  const password = `${username}pass`;
  const hash = await bcrypt.hash(password, 1);
  const id = "user-" + uuidv4();
  await pool.query(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)`,
    [id, username, hash]
  );
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username, password }).expect(200);
  return { id, agent };
}

describe("Deck sharing", () => {
  let alice, bob;
  let aliceDeckId, aliceCardId;

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM decks");
    await cleanupTestUsers();

    alice = await makeUser("alice");
    bob = await makeUser("bob");

    aliceDeckId = "deck-" + uuidv4();
    await pool.query(
      `INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)`,
      [aliceDeckId, alice.id, "Alice's Deck", "Test"]
    );
    aliceCardId = "card-" + uuidv4();
    await pool.query(
      `INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, 'basic')`,
      [aliceCardId, aliceDeckId, "Q", "A"]
    );
  });

  describe("POST /api/decks/:id/share", () => {
    it("returns 401 when unauthenticated", async () => {
      await request(app).post(`/api/decks/${aliceDeckId}/share`).expect(401);
    });

    it("creates a share token for the owner", async () => {
      const res = await alice.agent
        .post(`/api/decks/${aliceDeckId}/share`)
        .expect(201);
      assert.match(res.body.token, /^share-/);

      const check = await pool.query(
        "SELECT deck_id, created_by FROM share_tokens WHERE token = $1",
        [res.body.token]
      );
      assert.equal(check.rows.length, 1);
      assert.equal(check.rows[0].deck_id, aliceDeckId);
      assert.equal(check.rows[0].created_by, alice.id);
    });

    it("is idempotent — returns the same token on repeated calls", async () => {
      const first = await alice.agent
        .post(`/api/decks/${aliceDeckId}/share`)
        .expect(201);
      const second = await alice.agent
        .post(`/api/decks/${aliceDeckId}/share`)
        .expect(200);
      assert.equal(first.body.token, second.body.token);

      const check = await pool.query(
        "SELECT COUNT(*)::int FROM share_tokens WHERE deck_id = $1",
        [aliceDeckId]
      );
      assert.equal(check.rows[0].count, 1);
    });

    it("Bob cannot create a share token for Alice's deck (404)", async () => {
      await bob.agent.post(`/api/decks/${aliceDeckId}/share`).expect(404);

      const check = await pool.query(
        "SELECT COUNT(*)::int FROM share_tokens WHERE deck_id = $1",
        [aliceDeckId]
      );
      assert.equal(check.rows[0].count, 0);
    });

    it("returns 404 for a nonexistent deck", async () => {
      await alice.agent
        .post(`/api/decks/deck-${uuidv4()}/share`)
        .expect(404);
    });
  });

  describe("GET /api/shared/:token", () => {
    let token;

    beforeEach(async () => {
      const res = await alice.agent
        .post(`/api/decks/${aliceDeckId}/share`)
        .expect(201);
      token = res.body.token;
    });

    it("returns the deck and cards without authentication", async () => {
      const res = await request(app).get(`/api/shared/${token}`).expect(200);
      assert.equal(res.body.deck.id, aliceDeckId);
      assert.equal(res.body.deck.title, "Alice's Deck");
      assert.equal(res.body.cards.length, 1);
      assert.equal(res.body.cards[0].question, "Q");
    });

    it("does not expose user_id in the response", async () => {
      const res = await request(app).get(`/api/shared/${token}`).expect(200);
      assert.equal(res.body.deck.user_id, undefined);
    });

    it("works for authenticated non-owner users (Bob can view)", async () => {
      const res = await bob.agent.get(`/api/shared/${token}`).expect(200);
      assert.equal(res.body.deck.title, "Alice's Deck");
    });

    it("returns 404 for a nonexistent token", async () => {
      await request(app).get(`/api/shared/share-${uuidv4()}`).expect(404);
    });

    it("returns 404 after the original deck is deleted (cascade)", async () => {
      await alice.agent.delete(`/api/decks/${aliceDeckId}`).expect(200);
      await request(app).get(`/api/shared/${token}`).expect(404);

      const check = await pool.query(
        "SELECT COUNT(*)::int FROM share_tokens WHERE token = $1",
        [token]
      );
      assert.equal(check.rows[0].count, 0);
    });

    it("returns isOwnDeck=true for the owner and false for others", async () => {
      const ownerRes = await alice.agent.get(`/api/shared/${token}`).expect(200);
      assert.equal(ownerRes.body.isOwnDeck, true);

      const otherRes = await bob.agent.get(`/api/shared/${token}`).expect(200);
      assert.equal(otherRes.body.isOwnDeck, false);

      const anonRes = await request(app).get(`/api/shared/${token}`).expect(200);
      assert.equal(anonRes.body.isOwnDeck, false);
    });

    it("returns stats with correct card type counts", async () => {
      const res = await request(app).get(`/api/shared/${token}`).expect(200);
      assert.ok(res.body.stats, "stats should be present");
      assert.equal(typeof res.body.stats.total, "number");
      assert.equal(res.body.stats.total, 1);
      assert.equal(res.body.stats.basic, 1);
      assert.equal(res.body.stats.multiple_choice, 0);
    });

    it("returns creator username in deck object", async () => {
      const res = await request(app).get(`/api/shared/${token}`).expect(200);
      assert.equal(res.body.deck.creator, "alice");
    });
  });

  describe("POST /api/shared/:token/copy", () => {
    let token;

    beforeEach(async () => {
      const res = await alice.agent
        .post(`/api/decks/${aliceDeckId}/share`)
        .expect(201);
      token = res.body.token;
    });

    it("returns 401 when unauthenticated", async () => {
      await request(app)
        .post(`/api/shared/${token}/copy`)
        .expect(401);
    });

    it("Bob can copy Alice's deck to his account", async () => {
      const res = await bob.agent
        .post(`/api/shared/${token}/copy`)
        .expect(200);

      assert.equal(res.body.success, true);
      assert.match(res.body.deckId, /^deck-/);

      // Confirm deck was created under Bob's account
      const check = await pool.query(
        "SELECT user_id, title FROM decks WHERE id = $1",
        [res.body.deckId]
      );
      assert.equal(check.rows.length, 1);
      assert.equal(check.rows[0].user_id, bob.id);
      assert.equal(check.rows[0].title, "Alice's Deck");
    });

    it("copies all cards including choices", async () => {
      // Add an MCQ card to Alice's deck first
      const mcqCardId = "card-mcq-" + uuidv4();
      await pool.query(
        `INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, 'multiple_choice')`,
        [mcqCardId, aliceDeckId, "MCQ Q", "A"]
      );
      await pool.query(
        `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
        ["choice-1", mcqCardId, "A", true]
      );
      await pool.query(
        `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
        ["choice-2", mcqCardId, "B", false]
      );

      const res = await bob.agent
        .post(`/api/shared/${token}/copy`)
        .expect(200);

      // Confirm cards were copied
      const cards = await pool.query(
        "SELECT id FROM cards WHERE deck_id = $1",
        [res.body.deckId]
      );
      assert.equal(cards.rows.length, 2); // basic + mcq

      // Confirm choices were copied
      const choices = await pool.query(
        `SELECT cc.* FROM card_choices cc
         JOIN cards c ON c.id = cc.card_id
         WHERE c.deck_id = $1`,
        [res.body.deckId]
      );
      assert.equal(choices.rows.length, 2);
    });

    it("rejects if Alice tries to copy her own deck (403)", async () => {
      const res = await alice.agent
        .post(`/api/shared/${token}/copy`)
        .expect(403);
      assert.ok(res.body.error);
    });

    it("rejects duplicate copy if Bob already has a deck with the same title (409)", async () => {
      // Bob copies once
      await bob.agent.post(`/api/shared/${token}/copy`).expect(200);

      // Bob tries again
      const res = await bob.agent
        .post(`/api/shared/${token}/copy`)
        .expect(409);
      assert.ok(res.body.error);
    });

    it("returns 404 for a nonexistent token", async () => {
      await bob.agent
        .post(`/api/shared/share-${uuidv4()}/copy`)
        .expect(404);
    });

    it("copied card content matches the original exactly", async () => {
      // Add a basic and MCQ card to Alice's deck
      const mcqId = "card-mcq-copy-" + uuidv4();
      await pool.query(
        `INSERT INTO cards (id, deck_id, question, answer, card_type) VALUES ($1, $2, $3, $4, 'multiple_choice')`,
        [mcqId, aliceDeckId, "What is 2+2?", "4"]
      );
      await pool.query(
        `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
        ["ch-1-" + uuidv4(), mcqId, "4", true]
      );
      await pool.query(
        `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
        ["ch-2-" + uuidv4(), mcqId, "5", false]
      );

      const copyRes = await bob.agent
        .post(`/api/shared/${token}/copy`)
        .expect(200);

      // Fetch Bob's copy via API
      const deckRes = await bob.agent
        .get(`/api/decks/${copyRes.body.deckId}`)
        .expect(200);

      // Basic card copied correctly
      const basic = deckRes.body.cards.find(c => c.cardType === "basic");
      assert.ok(basic);
      assert.equal(basic.question, "Q");
      assert.equal(basic.answer, "A");

      // MCQ card copied correctly with choices
      const mcq = deckRes.body.cards.find(c => c.cardType === "multiple_choice");
      assert.ok(mcq);
      assert.equal(mcq.question, "What is 2+2?");
      assert.equal(mcq.choices.length, 2);
      const correct = mcq.choices.find(c => c.isCorrect);
      assert.equal(correct.choiceText, "4");
    });
  });

  describe("Edge cases", () => {
    it("sharing a deck with no cards returns empty cards array and zero stats", async () => {
      // Create an empty deck for Alice
      const emptyDeckId = "deck-empty-" + uuidv4();
      await pool.query(
        `INSERT INTO decks (id, user_id, title) VALUES ($1, $2, $3)`,
        [emptyDeckId, alice.id, "Empty Deck"]
      );
      const shareRes = await alice.agent
        .post(`/api/decks/${emptyDeckId}/share`)
        .expect(201);

      const res = await request(app)
        .get(`/api/shared/${shareRes.body.token}`)
        .expect(200);

      assert.equal(res.body.cards.length, 0);
      assert.equal(res.body.stats.total, 0);
      assert.equal(res.body.stats.basic, 0);
      assert.equal(res.body.stats.multiple_choice, 0);
    });
  });
});