// AI Job Search - web UI server.
//
// A single Node + Express process that:
//   - serves the static frontend from public/
//   - exposes JSON endpoints that run the framework's workflows via Claude
//   - fetches job postings from a URL server-side (so the browser avoids CORS)
//   - rate-limits per IP because the server key pays for every call
//
// Run: `npm install && npm start` (needs ANTHROPIC_API_KEY in the environment).

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { complete, isConfigured, config } from "./lib/anthropic.js";
import { TASKS } from "./lib/prompts.js";
import { createRateLimiter } from "./lib/ratelimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

// Per-IP limit. Defaults are conservative because the operator pays.
const limiter = createRateLimiter({
  windowMs: Number(process.env.RATE_WINDOW_MS || 60 * 60 * 1000), // 1 hour
  max: Number(process.env.RATE_MAX || 20), // 20 AI calls / hour / IP
});

const MAX_JOB_CHARS = 20000;

// --- Helpers ---------------------------------------------------------------

// Fetch a job posting URL and reduce it to plain-ish text. This is a best
// effort HTML strip, good enough to feed the model; it is not a full parser.
async function fetchJobText(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, "That does not look like a valid URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw httpError(400, "Only http and https URLs are supported.");
  }
  let res;
  try {
    res = await fetch(parsed.href, {
      headers: { "User-Agent": "ai-job-search-webui/1.0 (+github)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new httpError(
      502,
      "Could not fetch that URL. Paste the posting text instead.",
    );
  }
  if (!res.ok) {
    throw new httpError(
      502,
      `The job site returned ${res.status}. Paste the posting text instead.`,
    );
  }
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    throw new httpError(
      502,
      "That page had no readable text. Paste the posting text instead.",
    );
  }
  return text.slice(0, MAX_JOB_CHARS);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true; // intentional, user-facing message (incl. 502/503)
  return e;
}

// --- Routes ----------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    model: config.model,
  });
});

// Resolve a job URL to text (used by the frontend's "fetch" button).
app.post("/api/fetch-job", limiter, async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url) throw httpError(400, "Provide a url.");
    const text = await fetchJobText(url);
    res.json({ text });
  } catch (err) {
    next(err);
  }
});

// The main workflow endpoint. task = evaluate | cover-letter | cv | interview.
app.post("/api/:task", limiter, async (req, res, next) => {
  try {
    const { task } = req.params;
    const builder = TASKS[task];
    if (!builder) throw httpError(404, `Unknown task "${task}".`);

    if (!isConfigured()) {
      throw httpError(
        503,
        "The server is not configured with an ANTHROPIC_API_KEY yet.",
      );
    }

    const { profile = {}, jobUrl, format } = req.body || {};
    let jobText = (req.body?.jobText || "").trim();

    if (!jobText && jobUrl) {
      jobText = await fetchJobText(jobUrl);
    }
    if (!jobText) {
      throw httpError(400, "Provide the job posting text or a job URL.");
    }
    jobText = jobText.slice(0, MAX_JOB_CHARS);

    const prompt = builder({ profile, jobText, jobUrl, format });
    const result = await complete(prompt);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

// Static frontend.
app.use(express.static(path.join(__dirname, "public")));

// Error handler.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  // Only log genuinely unexpected failures, not intentional httpError()s.
  if (status >= 500 && !err.expose) console.error(err);
  res.status(status).json({
    error: status >= 500 ? "Server error" : "Request error",
    message: err.expose
      ? err.message
      : "Something went wrong handling that request.",
  });
});

app.listen(PORT, () => {
  console.log(`AI Job Search web UI running on http://localhost:${PORT}`);
  if (!isConfigured()) {
    console.warn(
      "WARNING: ANTHROPIC_API_KEY is not set - AI endpoints will return 503 until you add it.",
    );
  }
});
