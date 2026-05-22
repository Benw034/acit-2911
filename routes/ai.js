import { Router } from "express";
import DOMPurify from "isomorphic-dompurify";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const OLLAMA_BASE = String(process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_TAGS_API = `${OLLAMA_BASE}/api/tags`;
const OLLAMA_STREAM_API = `${OLLAMA_BASE}/api/generate`;
/** Fallback when no model is sent — set OLLAMA_MODEL in .env */
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4";

const PURIFY_OPTS = { FORBID_TAGS: ["style", "script", "iframe"] };

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? '';
const GROQ_API_KEY   = process.env.GROQ_API_KEY ?? '';
const GEMINI_MODEL   = 'gemini-3.1-flash-lite';
const GROQ_MODEL     = 'llama-3.3-70b-versatile';

function clampCardCount(n) {
  const x = parseInt(String(n), 10);
  if (Number.isNaN(x)) return 1;
  return Math.min(20, Math.max(1, x));
}

/** Pull a JSON array of {question, answer} from model output (may include markdown fences or prose). */
function extractCardsFromRaw(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty model output");

  let candidate = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();

  // Extract the outermost JSON structure
  let parsed;
  const arrStart = candidate.indexOf("[");
  const objStart = candidate.indexOf("{");

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    // Starts with array
    const arrEnd = candidate.lastIndexOf("]");
    if (arrEnd <= arrStart) throw new Error("No flashcard JSON array found in the response");
    parsed = JSON.parse(candidate.slice(arrStart, arrEnd + 1));
  } else if (objStart !== -1) {
    // Starts with object — may be a wrapper like { "flashcards": [...] }
    const objEnd = candidate.lastIndexOf("}");
    if (objEnd <= objStart) throw new Error("No flashcard JSON found in the response");
    const obj = JSON.parse(candidate.slice(objStart, objEnd + 1));
    // Look for any array value inside the wrapper object
    if (Array.isArray(obj)) {
      parsed = obj;
    } else {
      const arrayVal = Object.values(obj).find(v => Array.isArray(v));
      parsed = arrayVal ?? [obj];
    }
  } else {
    throw new Error("No flashcard JSON found in the response");
  }

  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of cards");

  const cards = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;

    // Case-insensitive field lookup
    const keys = Object.keys(item);
    const qKey = keys.find(k => k.toLowerCase() === "question");
    const aKey = keys.find(k => k.toLowerCase() === "answer");
    const q = DOMPurify.sanitize(String(qKey ? item[qKey] : ""), PURIFY_OPTS).trim();
    const rawAnswer = aKey ? DOMPurify.sanitize(String(item[aKey]), PURIFY_OPTS).trim() : "";

    if (!q) continue;

    // Normalize choices — models may return string array or object array
    const rawChoices = Array.isArray(item.choices) ? item.choices : [];
    const normalizedChoices = rawChoices.map(c => {
      if (typeof c === "string") {
        // Plain string — mark as correct if it matches the answer field
        const text = DOMPurify.sanitize(c, PURIFY_OPTS).trim();
        return { choiceText: text, isCorrect: text === rawAnswer };
      }
      return {
        choiceText: DOMPurify.sanitize(String(c.choiceText ?? c.text ?? ""), PURIFY_OPTS).trim(),
        isCorrect: !!c.isCorrect
      };
    }).filter(c => c.choiceText);

    // Detect T/F: explicit type field, or answer is literally "true"/"false"
    const explicitType = (item.type || "").toLowerCase().replace(/[^a-z_/]/g, "");
    const isTrueFalse = !normalizedChoices.length && (
      explicitType === "true_false" || explicitType === "true/false" ||
      rawAnswer.toLowerCase() === "true" || rawAnswer.toLowerCase() === "false"
    );

    // Derive answer for MCQ if not explicit
    const correctChoice = normalizedChoices.find(c => c.isCorrect);
    const answer = rawAnswer || (correctChoice ? correctChoice.choiceText : "");

    if (!answer && !normalizedChoices.length) continue;

    const card = { question: q, answer: answer || correctChoice?.choiceText || "" };

    if (normalizedChoices.length) {
      card.card_type = "multiple_choice";
      card.choices = normalizedChoices;
    } else if (isTrueFalse) {
      card.card_type = "multiple_choice";
      const isTrue = rawAnswer.toLowerCase() === "true";
      card.choices = [
        { choiceText: "true", isCorrect: isTrue },
        { choiceText: "false", isCorrect: !isTrue }
      ];
    } else {
      card.card_type = "basic";
      card.choices = [];
    }

    cards.push(card);
  }

  if (cards.length === 0) throw new Error("No valid question/answer pairs in JSON");
  return cards;
}

/**
 * GET /ai-chat — static UI lives at /ai-chat.html
 */
router.get("/", (req, res) => {
  res.redirect(302, "/ai-chat.html");
});

/**
 * GET /ai-chat/models — returns grouped models by provider
 */
router.get("/models", requireAuth, async (req, res) => {
  const result = {
    gemini: GOOGLE_API_KEY ? [GEMINI_MODEL] : [],
    groq:   GROQ_API_KEY   ? [GROQ_MODEL]   : [],
    ollama: [],
  };

  // Try to fetch local Ollama models (non-fatal if unavailable)
  try {
    const r = await fetch(OLLAMA_TAGS_API, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const data = await r.json();
      result.ollama = (Array.isArray(data.models) ? data.models : [])
        .map(m => (m && (m.name || m.model)) || '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
  } catch { /* Ollama offline — skip */ }

  res.json(result);
});

/**
 * POST /ai-chat
 * Body: { prompt, provider: 'gemini'|'groq'|'ollama', model, cardCount, cardType }
 * Streams NDJSON: { response: string, done: false } … { response: '', done: true }
 */
router.post("/", requireAuth, async (req, res) => {
  const { prompt, provider = 'gemini', cardType = 'basic' } = req.body;
  const cardCount = clampCardCount(req.body.cardCount);
  const model = (typeof req.body.model === 'string' && req.body.model.trim())
    ? req.body.model.trim().slice(0, 240)
    : (provider === 'groq' ? GROQ_MODEL : provider === 'ollama' ? OLLAMA_MODEL : GEMINI_MODEL);

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const typeInstruction = cardType === 'true_false'
    ? 'Each card must be a true/false question. The "answer" field must be exactly "true" or "false" (lowercase).'
    : cardType === 'multiple_choice'
    ? 'Each card must be a multiple choice question. Include a "choices" array of {choiceText, isCorrect} objects (exactly one isCorrect: true).'
    : cardType === 'random'
    ? 'Mix card types freely: some basic, some true/false (answer: "true"/"false"), some multiple choice (with choices array).'
    : 'Each card is a basic question/answer pair.';

  const systemPrompt = `You are a flashcard generator. Output ONLY valid JSON: a single array of exactly ${cardCount} objects. ${typeInstruction} No markdown fences, no explanation. Questions must be clear and concise; answers accurate and useful for studying.`;
  const userPrompt = `${prompt.trim()}\n\nReturn exactly ${cardCount} flashcards as a JSON array.`;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    if (provider === 'gemini') {
      if (!GOOGLE_API_KEY) return res.status(503).json({ error: 'GOOGLE_API_KEY not configured' });
      await streamGemini({ model, systemPrompt, userPrompt, res });
    } else if (provider === 'groq') {
      if (!GROQ_API_KEY) return res.status(503).json({ error: 'GROQ_API_KEY not configured' });
      await streamGroq({ model, systemPrompt, userPrompt, res });
    } else {
      await streamOllama({ model, systemPrompt, userPrompt, res });
    }
  } catch (error) {
    console.error('AI Chat error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Internal server error' });
    else res.end();
  }
});

// ── Provider streaming helpers ────────────────────────────────────

async function streamGemini({ model, systemPrompt, userPrompt, res }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GOOGLE_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Gemini error');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) res.write(JSON.stringify({ response: text, done: false }) + '\n');
      } catch { /* skip */ }
    }
  }
  res.write(JSON.stringify({ response: '', done: true }) + '\n');
  res.end();
}

async function streamGroq({ model, systemPrompt, userPrompt, res }) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Groq error');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const text = j.choices?.[0]?.delta?.content ?? '';
        if (text) res.write(JSON.stringify({ response: text, done: false }) + '\n');
      } catch { /* skip */ }
    }
  }
  res.write(JSON.stringify({ response: '', done: true }) + '\n');
  res.end();
}

async function streamOllama({ model, systemPrompt, userPrompt, res }) {
  const response = await fetch(OLLAMA_STREAM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model, prompt: userPrompt, system: systemPrompt, stream: true }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Ollama error');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.response) res.write(JSON.stringify({ response: j.response, done: false }) + '\n');
      } catch { /* skip */ }
    }
  }
  res.write(JSON.stringify({ response: '', done: true }) + '\n');
  res.end();
}


/**
 * POST /ai-chat/parse-cards
 * Parse model output into sanitized { question, answer }[].
 * Body: { raw: string }
 */
router.post("/parse-cards", requireAuth, (req, res) => {
  const { raw } = req.body;
  if (raw == null || typeof raw !== "string") {
    return res.status(400).json({ error: "raw text is required" });
  }
  try {
    const cards = extractCardsFromRaw(raw);
    res.json({ cards });
  } catch (e) {
    // Log the raw output so we can see what the model actually returned
    console.error("[parse-cards] Failed to parse. Error:", e.message);
    console.error("[parse-cards] Raw input (first 500 chars):", raw.slice(0, 500));
    res.status(400).json({ error: e.message || "Could not parse flashcards", rawPreview: raw.slice(0, 200) });
  }
});



export default router;