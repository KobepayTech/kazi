// Thin wrapper around the Anthropic SDK.
//
// The server holds a single ANTHROPIC_API_KEY and pays for all calls
// (server-key model). Model and token budget are configurable via env.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.MODEL || "claude-sonnet-5";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 2048);

let client = null;

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!isConfigured()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Run a single-turn completion and return the concatenated text.
 * @param {{system: string, user: string}} prompt
 */
export async function complete({ system, user }) {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export const config = { model: MODEL, maxTokens: MAX_TOKENS };
