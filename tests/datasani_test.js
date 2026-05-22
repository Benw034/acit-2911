import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { readFile } from "fs/promises";
import app from "../server.js"; 
import pool from "../db/pool.js"; 
import { createAuthedAgent, cleanupTestUsers } from "./helpers.js";

// Load the JSON attack vectors mapping directly from your file system
const testData = JSON.parse(
  await readFile(new URL("unsanitary-data.json", import.meta.url))
);

describe("Bulk Security Sanitization Integration", () => {
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

    // Establish a fixed parent node relation to reference during bulk loops
    await pool.query(
      "INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)",
      ["deck-bulk-security", userId, "Bulk Vector Test Deck", "Security Automation"]
    );
  });

  // Dynamic Test Case generation loops directly through your inputs array mapping
  testData.forEach((testCase) => {
    it(`Case: ${testCase.name}`, async () => {
      
      // Determine expected behavior layout branch context before posting 
      // If everything gets stripped to blank empty spaces, expect a 400 Bad Request
      const expectRejection = testCase.expected.replace(/\s+/g, " ").trim() === "";

      const payload = {
        question: testCase.input,
        answer: "Predictable Baseline Safe Answer Field Content"
      };

      if (expectRejection) {
        // Scenario A: Testing complete filter stripping validation failures
        const res = await agent
          .post("/api/decks/deck-bulk-security/cards")
          .send(payload)
          .expect(400);

        assert.deepEqual(res.body, { error: "Valid question and answer required" });

        // Confirm absolutely no orphaned data objects hit storage engines
        const dbCount = await pool.query("SELECT COUNT(*)::int FROM cards");
        assert.equal(dbCount.rows[0].count, 0);

      } else {
        // Scenario B: Testing standard sanitization filtration preservation
        const res = await agent
          .post("/api/decks/deck-bulk-security/cards")
          .send(payload)
          .expect(201);

        // Normalize text whitespace layouts exactly matching your evaluation functions
        const normalizedResult = res.body.question.replace(/\s+/g, " ").trim();
        const normalizedExpected = testCase.expected.replace(/\s+/g, " ").trim();

        // Trace evaluation transformations directly onto standard console buffers
        console.log(`\n[BULK INTERACTION VERIFICATION: ${testCase.name.toUpperCase()}]`);
        console.log(` Raw Input Parameter: ${testCase.input}`);
        console.log(` Managed API Result:  ${JSON.stringify(normalizedResult)}`);
        console.log(` Schema Expectation:  ${JSON.stringify(normalizedExpected)}`);

        assert.equal(normalizedResult, normalizedExpected, `Client response payload failed on: ${testCase.name}`);

        // Pull row directly out of storage engines to verify hard disk block mapping
        const dbCheck = await pool.query("SELECT question FROM cards WHERE id = $1", [res.body.id]);
        const normalizedDbResult = dbCheck.rows[0].question.replace(/\s+/g, " ").trim();

        assert.equal(normalizedDbResult, normalizedExpected, `Database layer value persistence failed on: ${testCase.name}`);
      }
    });
  });
});
