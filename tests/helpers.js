import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import request from "supertest";
import pool from "../db/pool.js";

/**
 * Creates a test user directly in the database (skipping the register route)
 * and returns a logged-in supertest agent + the user's id.
 *
 * The returned agent automatically includes the session cookie on subsequent
 * requests, so you can do agent.post(...).send(...) and it'll be authenticated.
 */
export async function createAuthedAgent(app, username = "testuser") {
  const password = "testpassword";
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = "user-" + uuidv4();

  await pool.query(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)`,
    [userId, username, passwordHash]
  );

  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ username, password })
    .expect(200);

  return { agent, userId };
}

/**
 * Cleans up sessions and users created by tests. Call in beforeEach BEFORE
 * creating new users to ensure a clean slate.
 */
export async function cleanupTestUsers() {
  await pool.query("DELETE FROM session");
  // share_tokens cascade from decks, but users cascade from users — be explicit
  await pool.query("DELETE FROM share_tokens");
  await pool.query("DELETE FROM users");
}
