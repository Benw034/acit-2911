import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js";
import pool from "../db/pool.js";
import { cleanupTestUsers } from "./helpers.js";

describe("Authentication API", () => {

  after(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM card_choices");
    await pool.query("DELETE FROM cards");
    await pool.query("DELETE FROM share_tokens");
    await pool.query("DELETE FROM decks");
    await cleanupTestUsers();
  });

  describe("POST /api/auth/register", () => {
    it("creates a new user and starts a session", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "newuser", password: "supersecret" })
        .expect(201);

      assert.match(res.body.id, /^user-/);
      assert.equal(res.body.username, "newuser");
      assert.equal(res.body.password_hash, undefined);

      // Session cookie should be set
      const setCookie = res.headers["set-cookie"];
      assert.ok(setCookie);
      assert.ok(setCookie[0].includes("connect.sid"));
    });

    it("stores password as a bcrypt hash, never plaintext", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ username: "hashtest", password: "supersecret" })
        .expect(201);

      const result = await pool.query(
        "SELECT password_hash FROM users WHERE username = $1",
        ["hashtest"]
      );
      const hash = result.rows[0].password_hash;
      assert.ok(hash.startsWith("$2"), "Password should be bcrypt hashed");
      assert.notEqual(hash, "supersecret");
    });

    it("rejects empty username with 400", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "", password: "supersecret" })
        .expect(400);
      assert.equal(res.body.error, "Username is required");
    });

    it("rejects password shorter than 8 characters with 400", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "shortpw", password: "short" })
        .expect(400);
      assert.equal(res.body.error, "Password must be at least 8 characters");
    });

    it("rejects duplicate username with 409", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ username: "dupe", password: "supersecret" })
        .expect(201);

      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "dupe", password: "anothersecret" })
        .expect(409);
      assert.equal(res.body.error, "Username already taken");
    });

    it("sanitizes script tags from username", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ username: "alice<script>alert(1)</script>", password: "supersecret" })
        .expect(201);

      assert.ok(!res.body.username.includes("<script>"));
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ username: "loginuser", password: "supersecret" });
    });

    it("logs in with correct credentials and starts a session", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "loginuser", password: "supersecret" })
        .expect(200);

      assert.equal(res.body.username, "loginuser");
      assert.match(res.body.id, /^user-/);
      const setCookie = res.headers["set-cookie"];
      assert.ok(setCookie);
    });

    it("rejects wrong password with 401", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "loginuser", password: "wrongpassword" })
        .expect(401);
      assert.equal(res.body.error, "Invalid username or password");
    });

    it("rejects nonexistent user with the same 401 message (no enumeration)", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "doesnotexist", password: "whatever" })
        .expect(401);
      assert.equal(res.body.error, "Invalid username or password");
    });

    it("rejects missing fields with 400", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "loginuser" })
        .expect(400);
      assert.equal(res.body.error, "Username and password required");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("destroys the session", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ username: "logoutuser", password: "supersecret" })
        .expect(201);

      // Confirm we're logged in
      await agent.get("/api/auth/me").expect(200);

      // Logout
      const res = await agent.post("/api/auth/logout").expect(200);
      assert.equal(res.body.success, true);

      // Confirm we're logged out
      await agent.get("/api/auth/me").expect(401);
    });

    it("is idempotent when not logged in", async () => {
      const res = await request(app).post("/api/auth/logout").expect(200);
      assert.equal(res.body.success, true);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns the current user when logged in", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ username: "meuser", password: "supersecret" })
        .expect(201);

      const res = await agent.get("/api/auth/me").expect(200);
      assert.equal(res.body.username, "meuser");
      assert.match(res.body.id, /^user-/);
    });

    it("returns 401 when not logged in", async () => {
      const res = await request(app).get("/api/auth/me").expect(401);
      assert.equal(res.body.error, "Not logged in");
    });
  });
});
