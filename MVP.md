# Kazi MVP

Kazi is the KobeOS recruitment product. The MVP uses the working recruitment workflow as its foundation and merges the most useful candidate-side idea from the `ai-job-search` branch: evaluate job fit before applying.

## Product roles

- **Recruitment agency tenant** — uploads or enters vacancies, reviews extracted fields, publishes jobs, confirms membership payments, and monitors hiring activity.
- **Applicant** — registers once, receives a generated CV, chooses filters, sees a swipe deck ranked by Kobe Fit, saves/skips/applies, and tracks application status.
- **Employer** — receives a private recruitment page automatically, sees applicants in real time, opens CVs, shortlists, interviews, rejects and hires.
- **KobeOS platform** — keeps tenant data isolated, extracts vacancy data, generates CVs, enforces membership rules, ranks matches, creates applications and publishes real-time events.

## End-to-end MVP loop

1. Agency receives an existing vacancy poster/message or employer submits a vacancy.
2. KobeOS extracts structured vacancy fields with confidence/evidence.
3. Agency staff review/correct and publish.
4. Employer client and private employer page are created/reused automatically.
5. Applicant registers and KobeOS generates one living CV from the profile.
6. Applicant submits a membership payment reference; agency confirms it.
7. Published jobs are filtered and ranked by **Kobe Fit**.
8. Applicant swipes left to skip, up to save, or right to apply.
9. Right swipe asks for explicit confirmation before sharing the CV.
10. Application is created and employer + agency dashboards update in real time.
11. Employer moves the applicant through viewed → shortlisted → interview → hired/rejected.
12. Applicant receives status updates and can track the application.

## Kobe Fit

The MVP fit engine is deterministic and explainable. It scores only data Kazi actually knows:

- relevant skills — 35%
- experience — 25%
- location/relocation — 15%
- language — 10%
- education/certificate requirement — 10%
- salary preference — 5%

The score uses the thresholds carried over from the candidate evaluation approach in the AI-job-search branch:

- 75–100: Strong fit
- 60–74: Good fit
- 45–59: Moderate fit
- 30–44: Weak fit
- below 30: Poor fit

A location mismatch is capped as a weak fit when the applicant has not agreed to relocate. A certificate-required vacancy is also capped when the profile is below certificate education level. This prevents a high score in unrelated dimensions from hiding a real blocker.

The swipe feed sorts by Kobe Fit first and publication date second. The match percentage and verdict are displayed as the first card highlight. Full job details also expose the structured fit object through the applicant job-detail API.

## MVP surfaces

- `/jobs` — applicant web app
- `/admin` — recruitment agency console
- `/e/<CODE>` — private employer recruitment page
- REST API + server-sent events for real-time updates
- SQLite persistence

## Local run

Requires Node.js 22.18 or newer.

```bash
npm ci
npm run seed
npm test
npm run typecheck
npm start
```

The seed command prints development credentials and example employer/applicant access data.

## CI

`.github/workflows/ci.yml` runs tests and TypeScript validation on MVP pushes and pull requests into `main`.

## Deliberately outside this MVP

These are not silently mocked as working features:

- automatic mobile-money reconciliation
- OCR-only vacancy poster ingestion
- WhatsApp/Instagram/Facebook API ingestion
- production SMS/WhatsApp notifications
- production email delivery
- external job-board scraping
- AI-generated tailored cover letters
- interview coaching
- behavioural/culture-fit scoring
- production identity verification/KYC
- cloud production deployment and managed database

Those can be added after the core recruitment loop is deployed and measured.
