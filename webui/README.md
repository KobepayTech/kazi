# AI Job Search - Web UI

A browser front-end for the [AI Job Search](../README.md) framework, so anyone
can use it without installing Claude Code, Python, LaTeX, or Bun locally.

It runs the same four workflows the CLI skills do, faithfully re-implementing
their methodology (see [`lib/prompts.js`](lib/prompts.js), which mirrors the
skill files under `.claude/skills/job-application-assistant/`):

| Tab | Backed by skill file | What it does |
|-----|----------------------|--------------|
| **Evaluate fit** | `04-job-evaluation.md` | Scores a posting on 5 weighted dimensions, gives a verdict, gaps, and whether to call the employer first |
| **Cover letter** | `03-writing-style.md` + `06-cover-letter-templates.md` | Drafts a forward-looking, one-page letter (no em-dashes, no cliches). Optional LaTeX output for `cover.cls` |
| **Tailor CV** | `05-cv-templates.md` | Tailored profile statement, reordered skills, rewritten bullets, ATS keyword check |
| **Interview prep** | `07-interview-prep.md` | Likely questions, STAR scaffolds, tough-question strategies, questions to ask back |

The candidate profile is entered in the browser and stored in `localStorage`
only. It is sent with each request but never persisted on the server.

## Cost model

This build uses a **server key**: one `ANTHROPIC_API_KEY` on the server pays
for every visitor's AI calls. That makes it frictionless for users but means
**you pay the bill**, so:

- Every AI endpoint is **rate limited per IP** (`RATE_MAX` calls per
  `RATE_WINDOW_MS`, default 20/hour). Tune before going public.
- There is **no auth**. For a truly public deployment, put it behind a login,
  a CAPTCHA, or a proxy like Cloudflare Access, and/or set a spend limit on
  your Anthropic account.
- Consider switching to a "bring your own key" model if usage grows.

## Run locally

```bash
cd webui
cp .env.example .env        # then paste your ANTHROPIC_API_KEY
npm install
npm start                   # http://localhost:3000
```

Without a key the site still loads and the status dot turns red; AI endpoints
return 503 until you add one.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `ANTHROPIC_API_KEY` | (required) | Server key that pays for all calls |
| `MODEL` | `claude-sonnet-5` | Anthropic model id |
| `MAX_TOKENS` | `2048` | Max output tokens per call |
| `PORT` | `3000` | HTTP port |
| `RATE_WINDOW_MS` | `3600000` | Rate-limit window (1 hour) |
| `RATE_MAX` | `20` | Max AI calls per window per IP |

## Deploy

The app is a single Node process serving both the API and the static
front-end, so it runs on any Node host.

- **Render**: a [`render.yaml`](render.yaml) blueprint is included. New →
  Blueprint → point at this repo → add `ANTHROPIC_API_KEY` as a secret.
- **Docker / Fly.io / Railway**: a [`Dockerfile`](Dockerfile) is included.
  `docker build -t aijs webui && docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... aijs`
- **Fly.io**: `fly launch --dockerfile Dockerfile` then
  `fly secrets set ANTHROPIC_API_KEY=...`

Set `ANTHROPIC_API_KEY` as a secret in the platform's dashboard; never commit
it. Also set a hard spend cap on your Anthropic account before sharing the URL.

## API

All endpoints are `POST` and JSON. Body: `{ profile, jobText?, jobUrl?, format? }`.

| Endpoint | Purpose |
|----------|---------|
| `/api/evaluate` | Job fit evaluation |
| `/api/cover-letter` | Cover letter (`format: "text" | "latex"`) |
| `/api/cv` | CV tailoring advice |
| `/api/interview` | Interview prep |
| `/api/fetch-job` | `{ url }` → `{ text }`, server-side fetch + HTML strip |
| `/api/health` | `{ ok, configured, model }` |

## Scope / limitations

This is a **working scaffold**, not a full SaaS. It intentionally does not
include: accounts/auth, a database, live job-board scraping (the framework's
Danish-portal Bun CLIs are not wired in here), or server-side LaTeX
compilation (the cover-letter LaTeX is returned as source to compile locally).
Those are natural next steps.

> Independent open-source project. Not affiliated with, endorsed by, or
> sponsored by Anthropic. No affiliated cryptocurrency or token.
