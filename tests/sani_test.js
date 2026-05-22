import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js"; 
import pool from "../db/pool.js"; 
import { createAuthedAgent, cleanupTestUsers } from "./helpers.js";

describe("Security Sanitization Integration", () => {
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

    // Establish a baseline clean deck destination to target during payloads
    await pool.query(
      "INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)",
      ["deck-security-id", userId, "Security Sandbox Deck", "QA Verification"]
    );
  });

  // ----------------------------------------------------------- XSS Scripts

  describe("XSS Protection End-to-End", () => {
    it("removes <script> tags entirely before database commit", async () => {
      const payload = {
        question: "Hello <script>alert('hacked')</script> World",
        answer: "Standard Safe Text"
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      // Verify immediate JSON endpoint response normalization
      assert.equal(res.body.question, "Hello  World");
      assert.ok(!res.body.question.includes("<script>"));

      // Verify the data saved on the database disk is strictly sanitized
      const dbCheck = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question, "Hello  World");
    });

    it("removes inline event handlers like onerror and onclick", async () => {
      const payload = {
        question: '<img src="x" onerror="alert(1)"> Test',
        answer: "Standard Safe Text"
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      assert.equal(res.body.question, '<img src="x"> Test');
      assert.ok(!res.body.question.includes("onerror"));

      const dbCheck = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question, '<img src="x"> Test');
    });

    it("removes javascript: protocols inside anchor tag links", async () => {
      const payload = {
        question: '<a href="javascript:alert(1)">Click me</a>',
        answer: "Standard Safe Text"
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      assert.equal(res.body.question, '<a>Click me</a>');
    });
  });

  // ----------------------------------------------------------- HTML Injection

  describe("HTML & Style Injection via Custom FORBID_TAGS Rules", () => {
    it("strips <iframe> tags cleanly to mitigate risk of clickjacking", async () => {
      const payload = {
        question: 'Check this: <iframe src="http://malicious.com"></iframe>',
        answer: "Standard Safe Text"
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      assert.equal(res.body.question.trim(), "Check this:");
      assert.ok(!res.body.question.includes("<iframe"));

      const dbCheck = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question.trim(), "Check this:");
    });

    it("removes <style> blocks that could break the application UI template layout", async () => {
      const payload = {
        question: "Title <style>body { display: none; }</style>",
        answer: "Title <style>body{color:red}</style>"
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      assert.equal(res.body.question.trim(), "Title");
      assert.equal(res.body.answer.trim(), "Title");
      assert.ok(!res.body.question.includes("<style"));
      assert.ok(!res.body.answer.includes("<style"));

      const dbCheck = await pool.query("SELECT question, answer FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question.trim(), "Title");
      assert.equal(dbCheck.rows[0].answer.trim(), "Title");
    });
  });

  // ----------------------------------------------------------- Data Integrity

  describe("Preserving Safe Semantic Content", () => {
    it("does NOT break normal text or safe structural HTML markup tags", async () => {
      const safeText = "What is <b>Bold</b> and i <i>Italic</i>?";
      const payload = {
        question: safeText,
        answer: safeText
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(payload)
        .expect(201);

      assert.equal(res.body.question, safeText);
      assert.equal(res.body.answer, safeText);

      const dbCheck = await pool.query("SELECT question, answer FROM cards WHERE id = $1", [res.body.id]);
      assert.equal(dbCheck.rows[0].question, safeText);
      assert.equal(dbCheck.rows[0].answer, safeText);
    });

    it("yields a 400 rejection status error if input strings reduce to absolute blanks post-sanitization", async () => {
      const dangerousPayload = {
        question: "<script>alert(1)</script>", // Reduces to pure empty string after DOMPurify processing
        answer: "   <iframe src=''></iframe>   " // Reduces to spaces which get trimmed away
      };

      const res = await agent
        .post("/api/decks/deck-security-id/cards")
        .send(dangerousPayload)
        .expect(400);

      assert.deepEqual(res.body, { error: "Valid question and answer required" });

      // Guarantee nothing was written into the table schema
      const countCheck = await pool.query("SELECT COUNT(*)::int FROM cards");
      assert.equal(countCheck.rows[0].count, 0);
    });
  });
});
