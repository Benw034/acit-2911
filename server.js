import express from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import process from "process";
import DOMPurify from "isomorphic-dompurify";
import pool from "./db/pool.js";
import { performance } from "perf_hooks";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import aiRouter from "./routes/ai.js";
import importRouter from "./routes/import.js";
import { requireAuth } from "./middleware/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: "session",
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: "lax",
  },
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/ai-chat", aiRouter);
app.use("/api/import", importRouter);

// AUTH ROUTES
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const sanitizeOpts = { FORBID_TAGS: ["style", "script", "iframe"] };
    const cleanUsername = DOMPurify.sanitize(username.trim(), sanitizeOpts);

    if (!cleanUsername) {
      return res.status(400).json({ error: "Invalid username content" });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      [cleanUsername],
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = "user-" + uuidv4();

    const createdUser = await pool.query(
      `INSERT INTO users (id, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username`,
      [id, cleanUsername, passwordHash],
    );

    req.session.userId = createdUser.rows[0].id;

    res.status(201).json(createdUser.rows[0]);
  } catch (err) {
    console.error("error registering user", err);
    res.status(500).json({ error: "database error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const result = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [username.trim()],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.userId = user.id;

    res.json({ id: user.id, username: user.username });
  } catch (err) {
    console.error("error logging in user", err);
    res.status(500).json({ error: "database error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("error destroying session", err);
      return res.status(500).json({ error: "could not log out" });
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const result = await pool.query(
      `SELECT id, username FROM users WHERE id = $1`,
      [req.session.userId],
    );

    if (result.rows.length === 0) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not logged in" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("error fetching current user", err);
    res.status(500).json({ error: "database error" });
  }
});

// DECK ROUTES
app.get("/api/decks", requireAuth, async (req, res) => {
  try {
    const deckList = await pool.query(`
    SELECT decks.id, decks.title, decks.category, COUNT(cards.id)::int AS "cardCount"
    FROM decks
    LEFT JOIN cards ON cards.deck_id = decks.id
    WHERE decks.user_id = $1
    GROUP BY decks.id
    ORDER BY decks.creation_time DESC`,
      [req.session.userId]);

    res.json(deckList.rows);
  } catch (err) {
    console.error("error getting decks", err);
    res.status(500).json({ error: "database error" });
  }
});

app.get("/api/decks/:deckId", requireAuth, async (req, res) => {
  try {
    const theDeck = await pool.query(
      `SELECT id, title, category FROM decks WHERE id = $1 AND user_id = $2`,
      [req.params.deckId, req.session.userId],
    );

    if (theDeck.rows.length === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    const totalCards = await pool.query(
      `SELECT
        c.id, c.question, c.answer, c.card_type AS "cardType", c.position,
        COALESCE(
          json_agg(
            json_build_object('id', cc.id, 'choiceText', cc.choice_text, 'isCorrect', cc.is_correct)
          ) FILTER (WHERE cc.id IS NOT NULL), '[]'
        ) AS choices
      FROM cards c
      LEFT JOIN card_choices cc ON cc.card_id = c.id
      WHERE c.deck_id = $1
      GROUP BY c.id
      ORDER BY c.position ASC`,
      [req.params.deckId],
    );

    res.json({
      ...theDeck.rows[0],
      cards: totalCards.rows,
    });
  } catch (err) {
    console.error("cant get deck:", err);
    res.status(500).json({ error: "database error" });
  }
});

app.post("/api/decks", requireAuth, async (req, res) => {
  try {
    const { title, category } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const sanitizeOpts = { FORBID_TAGS: ["style", "script", "iframe"] };
    const cleanTitle = DOMPurify.sanitize(title.trim(), sanitizeOpts);
    const cleanCategory = DOMPurify.sanitize(
      (category || "").trim().toLowerCase(),
      sanitizeOpts,
    );

    if (!cleanTitle) {
      return res.status(400).json({ error: "Invalid title content" });
    }

    const id = "deck-" + uuidv4();

    const createdDeck = await pool.query(
      `INSERT INTO decks (id, user_id, title, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, category`,
      [id, req.session.userId, cleanTitle, cleanCategory],
    );

    res.status(201).json({
      ...createdDeck.rows[0],
      cards: [],
    });
  } catch (err) {
    console.error("error creating deck", err);
    res.status(500).json({ error: "database error" });
  }
});

app.put("/api/decks/:deckId", requireAuth, async (req, res) => {
  try {
    const { title, category } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    const cleanTitle = DOMPurify.sanitize(title.trim(), {
      FORBID_TAGS: ["style", "script", "iframe"],
    });
    const cleanCategory = DOMPurify.sanitize((category || "").trim().toLowerCase(), {
      FORBID_TAGS: ["style", "script", "iframe"],
    });

    if (!cleanTitle) {
      return res.status(400).json({ error: "invalid title" });
    }

    const updatedDeck = await pool.query(
      `UPDATE decks
    SET title = $1, category = $2
    WHERE id = $3 AND user_id = $4
    RETURNING id, title, category`,
      [cleanTitle, cleanCategory, req.params.deckId, req.session.userId],
    );

    if (updatedDeck.rows.length === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    res.json(updatedDeck.rows[0]);
  } catch (err) {
    console.error("error updating deck", err);
    res.status(500).json({ error: "database error" });
  }
});

app.delete("/api/decks/:deckId", requireAuth, async (req, res) => {
  try {
    const deleteDeck = await pool.query(
      `DELETE FROM decks WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.deckId, req.session.userId],
    );

    if (deleteDeck.rows.length === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("error deleting deck", err);
    res.status(500).json({ error: "database error" });
  }
});

// POST /api/decks/:id/share — create or retrieve share link for a deck
// Auth required, owner only. Idempotent: returns existing token if one exists.
app.post("/api/decks/:id/share", requireAuth, async (req, res) => {
  const { id: deckId } = req.params;
  const userId = req.session.userId;

  try {
    // Verify deck exists and belongs to this user (404 on miss, not 403)
    const deckResult = await pool.query(
      "SELECT id FROM decks WHERE id = $1 AND user_id = $2",
      [deckId, userId]
    );
    if (deckResult.rowCount === 0) {
      return res.status(404).json({ error: "Deck not found" });
    }

    // Check for existing token (idempotent)
    const existing = await pool.query(
      "SELECT token FROM share_tokens WHERE deck_id = $1",
      [deckId]
    );
    if (existing.rowCount > 0) {
      return res.json({ token: existing.rows[0].token });
    }

    // Create new token
    const token = `share-${crypto.randomUUID()}`;
    await pool.query(
      "INSERT INTO share_tokens (token, deck_id, created_by) VALUES ($1, $2, $3)",
      [token, deckId, userId]
    );
    res.status(201).json({ token });
  } catch (err) {
    console.error("Error creating share token:", err);
    res.status(500).json({ error: "Failed to create share link" });
  }
});

// GET /api/shared/:token — fetch shared deck with cards, no auth required
app.get("/api/shared/:token", async (req, res) => {
  const { token } = req.params;

  try {
    const deckResult = await pool.query(
      `SELECT d.id, d.title, d.category, d.creation_time, d.user_id, u.username AS creator
       FROM share_tokens s
       JOIN decks d ON d.id = s.deck_id
       JOIN users u ON u.id = s.created_by
       WHERE s.token = $1`,
      [token]
    );
    if (deckResult.rowCount === 0) {
      return res.status(404).json({ error: "Shared deck not found" });
    }

    const deck = deckResult.rows[0];

    // Fetch cards with their choices
    const cardsResult = await pool.query(
      `SELECT c.id, c.question, c.answer, c.card_type AS "cardType", c.position,
        COALESCE(
          (SELECT json_agg(
            json_build_object('id', cc.id, 'choiceText', cc.choice_text, 'isCorrect', cc.is_correct)
            ORDER BY cc.id ASC
          ) FROM card_choices cc WHERE cc.card_id = c.id), '[]'
        ) AS choices
       FROM cards c
       WHERE c.deck_id = $1
       ORDER BY c.position ASC`,
      [deck.id]
    );

    const cards = cardsResult.rows;

    // Card type stats
    const stats = {
      total: cards.length,
      basic: cards.filter(c => c.cardType === 'basic').length,
      multiple_choice: cards.filter(c => c.cardType === 'multiple_choice').length,
    };

    // Let the client know if the requesting user owns this deck
    const requestingUserId = req.session?.userId;
    const isOwnDeck = requestingUserId === deck.user_id;

    // Strip user_id before sending — it's internal only
    delete deck.user_id;

    res.json({ deck, cards, stats, isOwnDeck });
  } catch (err) {
    console.error("Error fetching shared deck:", err);
    res.status(500).json({ error: "Failed to load shared deck" });
  }
});

// POST /api/shared/:token/copy — copy shared deck to authenticated user's account
app.post("/api/shared/:token/copy", requireAuth, async (req, res) => {
  const { token } = req.params;
  const userId = req.session.userId;

  const client = await pool.connect();
  try {
    // Fetch the shared deck
    const deckResult = await client.query(
      `SELECT d.id, d.title, d.category, d.user_id
       FROM share_tokens s
       JOIN decks d ON d.id = s.deck_id
       WHERE s.token = $1`,
      [token]
    );
    if (deckResult.rowCount === 0) {
      return res.status(404).json({ error: "Shared deck not found" });
    }

    const src = deckResult.rows[0];

    // Reject if the user owns the source deck
    if (src.user_id === userId) {
      return res.status(403).json({ error: "This is your own deck." });
    }

    // Check if user already has a copy of this deck (same title)
    const existingCheck = await client.query(
      `SELECT id FROM decks WHERE user_id = $1 AND title = $2`,
      [userId, src.title]
    );
    if (existingCheck.rowCount > 0) {
      return res.status(409).json({ error: "You already have this deck in your collection." });
    }

    // Fetch source cards with choices
    const cardsResult = await client.query(
      `SELECT c.id, c.question, c.answer, c.card_type, c.position,
        COALESCE(
          (SELECT json_agg(
            json_build_object('choiceText', cc.choice_text, 'isCorrect', cc.is_correct)
          ) FROM card_choices cc WHERE cc.card_id = c.id), '[]'
        ) AS choices
       FROM cards c WHERE c.deck_id = $1 ORDER BY c.position ASC`,
      [src.id]
    );

    await client.query('BEGIN');

    // Create new deck
    const newDeckId = `deck-${uuidv4()}`;
    await client.query(
      `INSERT INTO decks (id, user_id, title, category) VALUES ($1, $2, $3, $4)`,
      [newDeckId, userId, src.title, src.category]
    );

    // Copy cards and their choices
    for (const [idx, card] of cardsResult.rows.entries()) {
      const newCardId = `card-${uuidv4()}`;
      await client.query(
        `INSERT INTO cards (id, deck_id, question, answer, card_type, position) VALUES ($1, $2, $3, $4, $5, $6)`,
        [newCardId, newDeckId, card.question, card.answer, card.card_type, card.position ?? idx]
      );
      for (const choice of (card.choices || [])) {
        await client.query(
          `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
          [`choice-${uuidv4()}`, newCardId, choice.choiceText, choice.isCorrect]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, deckId: newDeckId, title: src.title });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error copying shared deck:", err);
    res.status(500).json({ error: "Failed to copy deck" });
  } finally {
    client.release();
  }
});

//  CARD ROUTES
app.get("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  try {
    const deckChecker = await pool.query(
      `SELECT id FROM decks WHERE id = $1 AND user_id = $2`,
      [req.params.deckId, req.session.userId],
    );

    if (deckChecker.rows.length === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    const cards = await pool.query(
      `SELECT
        c.id, c.question, c.answer, c.card_type AS "cardType", c.position,
        COALESCE(
          json_agg(
            json_build_object('id', cc.id, 'choiceText', cc.choice_text, 'isCorrect', cc.is_correct)
          ) FILTER (WHERE cc.id IS NOT NULL), '[]'
        ) AS choices
      FROM cards c
      LEFT JOIN card_choices cc ON cc.card_id = c.id
      WHERE c.deck_id = $1
      GROUP BY c.id
      ORDER BY c.position ASC`,
      [req.params.deckId],
    );

    res.json(cards.rows);
  } catch (err) {
    console.error("error getting cards", err);
    res.status(500).json({ error: "database error" });
  }
});


app.post("/api/decks/:deckId/cards", requireAuth, async (req, res) => {
  const { deckId } = req.params;
  const { question, answer, card_type, cardType, choices = [] } = req.body;
  
  // Support both snake_case and camelCase for the card type input
  const finalType = card_type || cardType || 'basic';
  const userId = req.session.userId; 
  const cardId = `card-${uuidv4()}`;

  const sanitizeOpts = { FORBID_TAGS: ["style", "script", "iframe"] };
  const cleanQuestion = DOMPurify.sanitize((question || '').trim(), sanitizeOpts);
  const cleanAnswer = DOMPurify.sanitize((answer || '').trim(), sanitizeOpts);

  if (!cleanQuestion || !cleanAnswer) {
    return res.status(400).json({ error: "Valid question and answer required" });
  }

  const client = await pool.connect(); 
  try {
    const deckCheck = await client.query(
      "SELECT id FROM decks WHERE id = $1 AND user_id = $2",
      [deckId, userId]
    );

    if (deckCheck.rowCount === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    await client.query('BEGIN');

    const posResult = await client.query(
      `SELECT COALESCE(MAX(position) + 1, 0) AS next_pos FROM cards WHERE deck_id = $1`,
      [deckId]
    );
    const position = posResult.rows[0].next_pos;

    // 1. Insert the Card
    await client.query(
      `INSERT INTO cards (id, deck_id, question, answer, card_type, position) VALUES ($1, $2, $3, $4, $5, $6)`,
      [cardId, deckId, cleanQuestion, cleanAnswer, finalType, position]
    );

    // 2. Insert choices if multiple choice (handling both underscore and hyphen naming)
    const isMultipleChoice = finalType.replace('-', '_') === 'multiple_choice';

    if (isMultipleChoice && Array.isArray(choices)) {
      for (const choice of choices) {
        const rawText = choice.choice_text || choice.choiceText || '';
        const isCorrect = choice.is_correct !== undefined ? choice.is_correct : choice.isCorrect;
        
        if (rawText.trim()) {
          const cleanChoiceText = DOMPurify.sanitize(rawText.trim(), sanitizeOpts);
          await client.query(
            `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
            [`choice-${uuidv4()}`, cardId, cleanChoiceText, !!isCorrect]
          );
        }
      }
    }

    await client.query('COMMIT');

    // 3. Fetch the full object using json_build_object to guarantee key casing
    const finalCardResult = await client.query(`
      SELECT
        c.id,
        c.question,
        c.answer,
        c.card_type AS "cardType",
        c.position,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', cc.id,
              'choiceText', cc.choice_text,
              'isCorrect', cc.is_correct
            ) ORDER BY cc.id ASC
          ) FROM card_choices cc WHERE cc.card_id = c.id), '[]'
        ) AS choices
      FROM cards c
      WHERE c.id = $1
    `, [cardId]);

    res.status(201).json(finalCardResult.rows[0]);

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error("Error creating card:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "database error" });
    }
  } finally {
    client.release();
  }
});


app.put("/api/decks/:deckId/cards/:cardId", requireAuth, async (req, res) => {
  const { deckId, cardId } = req.params;
  const { question, answer, card_type = 'basic', choices = [] } = req.body;
  const userId = req.session.userId;
  const sanitizeOpts = { FORBID_TAGS: ["style", "script", "iframe"] };
  const cleanQuestion = DOMPurify.sanitize(question.trim(), sanitizeOpts);
  const cleanAnswer = DOMPurify.sanitize(answer.trim(), sanitizeOpts);

  if (!cleanQuestion || !cleanAnswer) {
    return res.status(400).json({ error: "Valid question and answer required" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
const updateCardQuery = `
      UPDATE cards 
      SET question = $1, answer = $2, card_type = $3
      WHERE id = $4 
      AND deck_id = (SELECT id FROM decks WHERE id = $5 AND user_id = $6)
      RETURNING id, question, answer, card_type AS "cardType"
    `;
    const result = await client.query(updateCardQuery, [cleanQuestion, cleanAnswer, card_type, cardId, deckId, userId]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Card not found" });
    }

    // Clear old choices 
    await client.query('DELETE FROM card_choices WHERE card_id = $1', [cardId]);

    // Insert new choices if MCQ — accept both camelCase and snake_case from client
    if (card_type === 'multiple_choice' && choices.length > 0) {
      for (const choice of choices) {
        const rawText = choice.choiceText || choice.choice_text || '';
        const isCorrect = choice.isCorrect !== undefined ? choice.isCorrect : choice.is_correct;
        const cleanChoiceText = DOMPurify.sanitize(rawText.trim(), sanitizeOpts);
        if (cleanChoiceText) {
          await client.query(
            `INSERT INTO card_choices (id, card_id, choice_text, is_correct) VALUES ($1, $2, $3, $4)`,
            [`choice-${uuidv4()}`, cardId, cleanChoiceText, !!isCorrect]
          );
        }
      }
    }

    await client.query('COMMIT');

    // Re-fetch the full card with choices so the client gets consistent data
    const finalCard = await client.query(`
      SELECT
        c.id, c.question, c.answer, c.card_type AS "cardType", c.position,
        COALESCE(
          (SELECT json_agg(
            json_build_object('id', cc.id, 'choiceText', cc.choice_text, 'isCorrect', cc.is_correct)
            ORDER BY cc.id ASC
          ) FROM card_choices cc WHERE cc.card_id = c.id), '[]'
        ) AS choices
      FROM cards c WHERE c.id = $1
    `, [cardId]);

    res.json(finalCard.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error updating card:", err);
    res.status(500).json({ error: "database error" });
  } finally {
    client.release();
  }
});

app.delete("/api/decks/:deckId/cards/:cardId", requireAuth, async (req, res) => {
  try {
    const deckChecker = await pool.query(
      `SELECT id FROM decks WHERE id = $1 AND user_id = $2`,
      [req.params.deckId, req.session.userId],
    );
    if (deckChecker.rows.length === 0) {
      return res.status(404).json({ error: "deck not found" });
    }

    const deleteCard = await pool.query(
      `DELETE FROM cards WHERE id = $1 AND deck_id = $2 RETURNING id`,
      [req.params.cardId, req.params.deckId],
    );

    if (deleteCard.rows.length === 0) {
      return res.status(404).json({ error: "card not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("error deleting card", err);
    res.status(500).json({ error: "database error" });
  }
});

// STARTUP METRICS
async function printStartupMetrics() {
  try {
    const startTime = performance.now();

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users)        AS users,
        (SELECT COUNT(*) FROM decks)        AS decks,
        (SELECT COUNT(*) FROM cards)        AS cards,
        (SELECT COUNT(*) FROM card_choices) AS choices,
        (SELECT COUNT(*) FROM share_tokens) AS shared,
        (SELECT COUNT(*) FROM session)      AS sessions
    `);

    const durationMs = (performance.now() - startTime).toFixed(2);
    const row = counts.rows[0];

    console.log("-----------------------------------------");
    console.log("📊 Startup Metrics:");
    console.log(`   • Users:         ${row.users}`);
    console.log(`   • Decks:         ${row.decks}`);
    console.log(`   • Cards:         ${row.cards}`);
    console.log(`   • MCQ Choices:   ${row.choices}`);
    console.log(`   • Shared Decks:  ${row.shared}`);
    console.log(`   • Sessions:      ${row.sessions}`);
    console.log(`   • DB Query:      ${durationMs}ms`);
    console.log("-----------------------------------------");
  } catch (error) {
    console.error("⚠️ Startup database diagnostic failure:", error.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, async () => {
    console.log(`Flashcard app running at http://localhost:${PORT}`);
    await printStartupMetrics();
  });
}

export default app;