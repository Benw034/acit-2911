import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js";
import pool from "../db/pool.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { cleanupTestUsers } from "./helpers.js";

/**
 * Creates a user directly via SQL and returns their id + a logged-in agent.
 * This lets us set up two distinct users in one beforeEach without going
 * through the register route twice (which would be slower).
 */
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

describe("Ownership and Auth Protection", () => {
  let alice, bob;
  let aliceDeckId, aliceCardId;

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM decks");
    await cleanupTestUsers();

    alice = await makeUser("alice");
    bob = await makeUser("bob");

    // Give Alice a deck with one card
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

  describe("Unauthenticated requests", () => {
    it("returns 401 from GET /api/decks", async () => {
      await request(app).get("/api/decks").expect(401);
    });

    it("returns 401 from GET /api/decks/:id", async () => {
      await request(app).get(`/api/decks/${aliceDeckId}`).expect(401);
    });

    it("returns 401 from POST /api/decks", async () => {
      await request(app)
        .post("/api/decks")
        .send({ title: "Anonymous Deck" })
        .expect(401);
    });

    it("returns 401 from PUT /api/decks/:id", async () => {
      await request(app)
        .put(`/api/decks/${aliceDeckId}`)
        .send({ title: "Hijacked" })
        .expect(401);
    });

    it("returns 401 from DELETE /api/decks/:id", async () => {
      await request(app).delete(`/api/decks/${aliceDeckId}`).expect(401);
    });

    it("returns 401 from card routes", async () => {
      await request(app).get(`/api/decks/${aliceDeckId}/cards`).expect(401);
      await request(app)
        .post(`/api/decks/${aliceDeckId}/cards`)
        .send({ question: "Q", answer: "A" })
        .expect(401);
      await request(app)
        .delete(`/api/decks/${aliceDeckId}/cards/${aliceCardId}`)
        .expect(401);
    });
  });

  describe("Deck list scoping", () => {
    it("returns only the logged-in user's decks", async () => {
      // Give Bob a deck too
      await pool.query(
        `INSERT INTO decks (id, user_id, title) VALUES ($1, $2, $3)`,
        ["deck-" + uuidv4(), bob.id, "Bob's Deck"]
      );

      const aliceRes = await alice.agent.get("/api/decks").expect(200);
      assert.equal(aliceRes.body.length, 1);
      assert.equal(aliceRes.body[0].title, "Alice's Deck");

      const bobRes = await bob.agent.get("/api/decks").expect(200);
      assert.equal(bobRes.body.length, 1);
      assert.equal(bobRes.body[0].title, "Bob's Deck");
    });
  });

  describe("Cross-user deck access", () => {
    it("Bob cannot GET Alice's deck (returns 404, not 403)", async () => {
      const res = await bob.agent.get(`/api/decks/${aliceDeckId}`).expect(404);
      assert.equal(res.body.error, "deck not found");
    });

    it("Bob cannot UPDATE Alice's deck", async () => {
      await bob.agent
        .put(`/api/decks/${aliceDeckId}`)
        .send({ title: "Hijacked", category: "Stolen" })
        .expect(404);

      // Confirm the deck is unchanged
      const check = await pool.query(
        "SELECT title FROM decks WHERE id = $1",
        [aliceDeckId]
      );
      assert.equal(check.rows[0].title, "Alice's Deck");
    });

    it("Bob cannot DELETE Alice's deck", async () => {
      await bob.agent.delete(`/api/decks/${aliceDeckId}`).expect(404);

      // Confirm the deck still exists
      const check = await pool.query(
        "SELECT id FROM decks WHERE id = $1",
        [aliceDeckId]
      );
      assert.equal(check.rows.length, 1);
    });
  });

  describe("Cross-user card access", () => {
    it("Bob cannot GET cards from Alice's deck", async () => {
      await bob.agent
        .get(`/api/decks/${aliceDeckId}/cards`)
        .expect(404);
    });

    it("Bob cannot POST a card to Alice's deck", async () => {
      await bob.agent
        .post(`/api/decks/${aliceDeckId}/cards`)
        .send({ question: "Sneaky Q", answer: "Sneaky A" })
        .expect(404);

      // Confirm no new card was added
      const check = await pool.query(
        "SELECT COUNT(*)::int FROM cards WHERE deck_id = $1",
        [aliceDeckId]
      );
      assert.equal(check.rows[0].count, 1);
    });

    it("Bob cannot UPDATE Alice's card", async () => {
      await bob.agent
        .put(`/api/decks/${aliceDeckId}/cards/${aliceCardId}`)
        .send({ question: "Hijacked Q", answer: "Hijacked A" })
        .expect(404);

      // Confirm the card is unchanged
      const check = await pool.query(
        "SELECT question FROM cards WHERE id = $1",
        [aliceCardId]
      );
      assert.equal(check.rows[0].question, "Q");
    });

    it("Bob cannot DELETE Alice's card", async () => {
      await bob.agent
        .delete(`/api/decks/${aliceDeckId}/cards/${aliceCardId}`)
        .expect(404);

      // Confirm the card still exists
      const check = await pool.query(
        "SELECT id FROM cards WHERE id = $1",
        [aliceCardId]
      );
      assert.equal(check.rows.length, 1);
    });
  });

  describe("Same-user access (sanity check)", () => {
    it("Alice can fetch her own deck", async () => {
      const res = await alice.agent.get(`/api/decks/${aliceDeckId}`).expect(200);
      assert.equal(res.body.title, "Alice's Deck");
      assert.equal(res.body.cards.length, 1);
    });

    it("Alice can update her own deck", async () => {
      await alice.agent
        .put(`/api/decks/${aliceDeckId}`)
        .send({ title: "Renamed", category: "Updated" })
        .expect(200);
    });

    it("Alice can add cards to her own deck", async () => {
      const res = await alice.agent
        .post(`/api/decks/${aliceDeckId}/cards`)
        .send({ question: "New Q", answer: "New A" })
        .expect(201);
      assert.match(res.body.id, /^card-/);
    });
  });
});