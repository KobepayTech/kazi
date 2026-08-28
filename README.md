# Kazi

Kazi by KobeOS turns a recruitment agency's **existing job posts** into swipe-to-apply job
cards, and gives the employer behind each post a **private page that fills up in
real time**.

The agency keeps doing what it already does well — finding vacancies and making
posters. KobeOS adds the application, CV, membership and employer-management
layer on top.

```
agency's existing poster
        ↓
   upload to KobeOS
        ↓
   Kobe AI extracts the vacancy
        ↓
   agency staff approve
        ↓
   swipe card goes live
        ↓
   applicant swipes right and confirms
        ↓
   CV is attached and submitted automatically
        ↓
   employer sees the applicant instantly
        ↓
   employer shortlists / interviews / hires
        ↓
   applicant's status updates
```

This repository is the **MVP**: the smallest thing that proves that loop.

## Multi-tenant from day one

KobeOS is the platform; the agency is a tenant. Every business row carries a
`tenant_id`, so a second agency is a row rather than a fork.

```
KobeOS
  └── Recruitment service
        └── Tenant: Soko Huru        ← today
              ├── agency staff
              ├── applicants
              ├── employers
              ├── jobs
              ├── memberships
              └── applications
```

A tenant's API key both authenticates the console and selects the tenant, and
sessions are checked against the tenant that issued them
(`tests/tenancy.test.ts` covers the isolation).

## Quick start

Requires Node 22.18+ — no runtime dependencies, no build step, no database
server. Storage is `node:sqlite`, HTTP is `node:http`, crypto is `node:crypto`.

```bash
npm install          # devDependencies only: typescript + @types/node
npm run seed         # demo tenant, posters, applicants, payments, applications
npm start            # http://localhost:3000
npm test             # 85 tests
npm run typecheck
```

`npm run seed` prints the employer links, employer access codes and applicant
tokens it created. Sign in to the agency console with the development key
`dev-agency-key`.

| Surface        | URL                | Who signs in                          |
| -------------- | ------------------ | ------------------------------------- |
| Applicant app  | `/jobs`            | phone number (registration is a form) |
| Agency admin   | `/admin`           | staff key                             |
| Employer page  | `/e/<CODE>`        | access code, or an OTP                |

The employer page also carries an optional form for posting a vacancy directly;
see below.

## The four participants

**The agency** receives vacancies, makes its posters as usual, uploads them to
KobeOS, checks the extraction, publishes, confirms membership payments, and can
act on a client's behalf.

**KobeOS** reads the poster, builds the card, writes each applicant's CV,
enforces the membership rules, files applications, generates the employer page
and pushes every change live.

**The employer client** never *has* to fill in a form — publishing a job
creates the client record and a private link on first sight. If they would
rather type a vacancy themselves, their page lets them, and it goes to the
agency to check.

**The applicant** registers once, pays for a package, and swipes. Their CV is
written for them and attached automatically.

## How each piece works

### Kobe AI extraction

`src/domain/extraction.ts` is a deterministic, offline reader for Tanzanian
recruitment posts in English, Swahili or both. It pulls out title, employer,
location, salary, positions, description, responsibilities, requirements,
deadline and contact details.

Every value carries **a confidence score and the poster line it came from**, so
the review screen can put the original poster on the left and the extracted
fields on the right, with anything uncertain highlighted. Nothing is published
until a human presses the button.

Salaries are normalised to a monthly TZS figure (`src/domain/salary.ts`) so one
"minimum salary" filter can compare a USD hotel wage with a TZS call-centre wage.

`AssistedExtractor` wraps any text-completion function behind the same
interface. It never overrides a value the poster stated on a labelled line, and
a model failure falls back to the rule-based reading rather than blocking the
agency from publishing.

### Two ways a vacancy arrives — one review queue

The default is the agency uploading a post it already made. But a client who
would rather type it can: their private page has an optional **Post a vacancy**
form.

Either way the vacancy lands in the **same review queue** and goes live only
when agency staff publish it. The queue marks which is which, so staff can see
at a glance whether they are checking an extraction or a client's own wording.
Publishing a client-typed vacancy attributes it to that client automatically —
no name to re-enter, same link, no new access code.

That keeps the agency in the loop (listings stay consistent and filterable) and
keeps the low-friction path open for employers who just want to send a WhatsApp
message.

**There is deliberately no OCR.** Every intake path is text: a pasted message,
a typed form, or a poster image with its text alongside. OCR would only serve
the case where an image is the *only* artefact, and at MVP volume retyping
those is cheaper than the dependency. `jobs.intake_channel` records how each
vacancy actually arrived (`poster_image`, `whatsapp_text`, `pasted_text`,
`manual_entry`, `employer_form`), so the decision can be revisited with real
numbers rather than a guess.

### Applicant registration and application documents

Registration is one short form. Kazi writes a base CV from it
(`src/domain/cv.ts`) and rewrites it whenever the profile changes.

When the applicant confirms a right swipe, Kazi also runs the
`ai-job-search`-inspired application workflow in
`src/domain/application-package.ts`:

1. evaluate the applicant/job fit;
2. tailor the CV to the vacancy without inventing experience or achievements;
3. draft a truthful cover letter in English or Swahili based on the vacancy;
4. prepare interview questions, STAR prompts and questions for the applicant to ask.

The applicant can reopen this package from **Applications**, and the employer sees
the tailored CV and cover letter when opening the candidate. The employer does
not receive an automated hire/reject recommendation.

### Membership and payment

The three packages are seeded per tenant and editable from the admin page:

| Package                      | Price      | Covers                            |
| ---------------------------- | ---------- | --------------------------------- |
| Jobs without certificates    | TSh 15,000 | non-certificate jobs              |
| Jobs requiring certificates  | TSh 30,000 | certificate and non-certificate   |
| Special Service              | TSh 50,000 | everything, longer duration       |

Payment in the MVP is: **pay by mobile money → submit the transaction reference
→ the agency confirms → the membership activates**. Automatic reconciliation is
V2. No code branches on a package code; the rules are columns on the row, so
the agency can reprice or add packages without a deployment.

### The swipe deck

One job fills the screen. Real finger swiping (pointer events, drag with
rotation and a release threshold), plus buttons:

- **left** — skip, and it never returns to the deck
- **right** — apply
- **star / up** — save
- **tap** — the full advert, including the original poster image

Filters, deliberately just four: location, minimum salary, job category, and
certificate required or not.

### A right swipe never submits on its own

The first right swipe returns a confirmation prompt; only a confirmed call
creates the application:

```
Apply for Hotel Attendant?
Your CV will be shared with this employer.
                        [Cancel]  [Apply]
```

This is enforced in the service, not just the UI (`SwipeService.swipe` takes a
`confirmed` flag), so an accidental swipe cannot send someone's CV.

### The employer page

`/e/7HK29D`. The short code **names** the client; a separate access code or OTP
**proves** it is them, so a forwarded link is not a credential. There is no SMS
gateway in the MVP, so a requested OTP is relayed to the agency console for
staff to pass on — the API response never contains the code.

The page shows live tiles (positions, applicants, new, viewed, shortlisted,
interview, hired, left to fill) and candidate cards with View CV, Add note,
Shortlist, Interview, Hire and Reject. Pressing Shortlist updates the
applicant's phone immediately.

Every employer-facing query is filtered by `employer_id` in the data layer, so
one client can never see another's candidates.

### Status flow

```
Applied → Viewed → Shortlisted → Interview → Hired / Rejected
```

Rejection is reachable from any live stage; the applicant may withdraw until a
decision is recorded. Transitions are validated in `src/domain/applications.ts`,
so the employer page, the agency console and the API all enforce the same steps.
Employer tiles count every application that *ever reached* a stage, so a
candidate who moves on still counts on the earlier tile.

### Real time

An SSE stream per employer, per applicant and per agency. Events are written to
the database before they are pushed, so a page that reconnects replays what it
missed with `Last-Event-ID` instead of showing stale numbers.

## Layout

```
src/
  config.ts              tenant defaults, FX rates, thresholds
  app.ts                 platform wiring, tenant contexts, key/session resolution
  domain/                pure logic, no I/O
    types.ts             the vocabulary
    extraction.ts        Kobe AI poster reader
    salary.ts            parsing and TZS normalisation
    feed.ts              the four filters + eligibility
    plans.ts             package coverage rules
    cv.ts                base CV generation and rendering
    application-package.ts job-specific CV, cover letter and interview prep
    applications.ts      status flow and permissions
    cards.ts             swipe card assembly
  data/
    db.ts                schema (every table has tenant_id)
    store.ts             Store (platform) + TenantStore (scoped queries)
  services/              intake, applicants, memberships, swipe, employer, agency, access, uploads
  http/                  router, routes, server
  web/                   applicant app, agency admin, employer page
  bin/                   serve, seed
tests/                   85 tests
```

## Data model

`tenants`, `users`, `applicant_profiles`, `applicant_preferences`, `cvs`,
`membership_plans`, `memberships`, `payments`, `employers`, `jobs`,
`applications`, `application_status_history` — plus `sessions`,
`employer_access_grants`, `job_drafts`, `swipes`, `reference_counters` and
`realtime_events` as supporting infrastructure.

## Configuration

| Variable                | Default                   | Meaning                             |
| ----------------------- | ------------------------- | ----------------------------------- |
| `PORT`                  | `3000`                    | HTTP port                           |
| `KOBEOS_DB`             | `data/kobeos.db`          | SQLite file                         |
| `KOBEOS_PUBLIC_URL`     | `https://jobs.kobeos.app` | base for employer links             |
| `KOBEOS_UPLOADS_DIR`    | `data/uploads`            | posters, photos, certificates       |
| `KOBEOS_TENANT_NAME`    | `Soko Huru`               | bootstrap tenant                    |
| `KOBEOS_TENANT_SLUG`    | `soko-huru`               | bootstrap tenant slug               |
| `KOBEOS_TENANT_KEY`     | `dev-agency-key`          | **set this before deploying**       |
| `KOBEOS_SESSION_TTL_MINUTES` | `720`                | session lifetime                    |
| `KOBEOS_OTP_TTL_MINUTES`| `10`                      | OTP lifetime                        |

## Security notes

- Access codes, OTPs and tenant API keys are stored as salted scrypt hashes;
  session tokens as SHA-256 hashes. Nothing is kept in the clear.
- Repeated wrong codes lock the grant out after five attempts.
- A bad code returns the same message for a real link and an unknown one, so
  the employer link cannot be used to probe for clients.
- Uploads are extension-checked, size-capped and served from a single directory
  with traversal refused.

## Deliberately not in the MVP

Automated employer-side candidate ranking, video interviews, employer subscription plans,
complex ATS workflows, WhatsApp and Instagram automation, persisted document version history,
interview calendar integration, public company websites, open-web recommendation agents,
automatic mobile-money reconciliation, and parsing uploaded legacy CVs.

Those are V2. The MVP keeps to the loop at the top of this file.

## Gender and age requirements on posters

Posters often state a gender or age requirement. The extractor keeps that
wording in the job's **requirements list**, where the employer and the applicant
can both read it, but the MVP does **not** use it to filter who may apply. That
avoids building automated screening on those attributes in v1; the employer
still makes its own decision on each candidate.
