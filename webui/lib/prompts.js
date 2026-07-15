// Prompt builders for the AI Job Search web UI.
//
// These encode the same career-guidance methodology as the Claude Code skills
// in `.claude/skills/job-application-assistant/`:
//   - 04-job-evaluation.md  -> buildEvaluatePrompt
//   - 03-writing-style.md + 06-cover-letter-templates.md -> buildCoverLetterPrompt
//   - 05-cv-templates.md    -> buildCvPrompt
//   - 07-interview-prep.md  -> buildInterviewPrompt
//
// Keeping the logic here (rather than a generic "write me a cover letter"
// prompt) is what makes the web version faithful to the framework.

/**
 * Render the candidate profile object into a compact text block that every
 * request shares. Missing fields are simply omitted.
 */
export function renderProfile(profile = {}) {
  const rows = [
    ["Name", profile.name],
    ["Current / most recent role", profile.currentRole],
    ["Location", profile.location],
    ["Target roles", profile.targetRoles],
    ["Education", profile.education],
    ["Primary skills", profile.primarySkills],
    ["Secondary skills", profile.secondarySkills],
    ["Experience summary", profile.experience],
    ["Notable achievements", profile.achievements],
    ["Career goals", profile.careerGoals],
    ["Tasks that energize me", profile.energizingTasks],
    ["Tasks that drain me", profile.drainingTasks],
    ["Preferred language for applications", profile.language],
  ];
  const filled = rows.filter(([, v]) => v && String(v).trim());
  if (filled.length === 0) {
    return "(No candidate profile was provided. Ask the user to fill in their profile for a personalised result, and give best-effort generic guidance meanwhile.)";
  }
  return filled.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join("\n");
}

const WRITING_STYLE_RULES = `WRITING STYLE RULES (non-negotiable):
- NO em-dashes. Use commas, periods, or restructure the sentence.
- NO cliches or filler ("passionate about", "great fit", "leverage my skills", "hit the ground running", "drive results", "synergies").
- NO generic buzzwords without concrete backing. Every claim must be supported by a specific example or fact.
- NO apologetic or overly humble language. Write "I bring X, demonstrated by Y", not "I think I could contribute".
- Warm but direct. Confident without arrogance. First person, active voice. Demonstrate, don't state.
- Reframe emphasis, not substance. Never claim experience the candidate does not have. If a framing is a stretch, flag it explicitly rather than asserting it.
- Do NOT invent company facts (partnerships, products, technologies). If you are not certain a company-specific claim is true, keep it general or omit it.`;

const LANGUAGE_RULE = (profile) =>
  profile?.language
    ? `Write output in ${profile.language} unless the job posting is clearly in a different language, in which case match the posting's language.`
    : `Default to the language of the job posting. If none is detectable, use English.`;

/**
 * Step 1 - Job fit evaluation (mirrors 04-job-evaluation.md).
 */
export function buildEvaluatePrompt({ profile, jobText, jobUrl }) {
  const system = `You are an expert career advisor and job-fit evaluator. You score a job posting against a candidate's profile using a fixed, rigorous framework and return a structured evaluation. Be honest and specific; do not inflate scores to be encouraging.

Score these dimensions 0-100 (Location is Pass/Fail):
1. Technical Skills Match (weight 30%): 80-100 core requirements are primary skills; 60-79 most match with 1-2 learnable gaps; 40-59 partial, significant upskilling; 0-39 fundamental mismatch.
2. Experience Match (weight 25%): 80-100 direct same-domain/role experience; 60-79 related, transferable; 40-59 adjacent, must make the case; 0-39 unrelated.
3. Behavioral / Culture Fit (weight 15%): based on the role and any culture signals in the posting vs the candidate's stated preferences.
4. Location & Logistics (Pass/Fail): within commute or remote = PASS; requires relocation = FAIL; heavy travel = FLAG.
5. Career Alignment & Motivation (weight 30%): does the role advance the candidate's stated career goals, and do the day-to-day tasks energize rather than drain them?

Overall Score = weighted average of the four scored dimensions (Technical 30, Experience 25, Behavioral 15, Career 30). Location is a gate, not weighted.

Verdict thresholds: 75+ Strong Fit (definitely apply); 60-74 Good Fit (apply, address gaps); 45-59 Moderate Fit (consider carefully); 30-44 Weak Fit (probably skip); <30 Poor Fit (skip).

Also decide whether the candidate should CALL the employer before applying. Only recommend calling when there are substantive questions (ambiguous requirements, unclear essential vs nice-to-have competencies, vague day-to-day description) AND a named contact invites questions. Never recommend calling merely "to be remembered".

Return your answer as GitHub-flavored Markdown in exactly this structure:

## Job Fit Evaluation: <Role> at <Company>

| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | XX/100 | ... |
| Experience Match | XX/100 | ... |
| Behavioral Fit | XX/100 | ... |
| Location | PASS/FAIL/FLAG | ... |
| Career Alignment | XX/100 | ... |

**Overall Score: XX/100**

### Verdict: <Strong / Good / Moderate / Weak / Poor> Fit

### Key Strengths for This Role
- ...

### Gaps to Address
- ...

### Recommendation
<1-2 sentences: apply / skip / apply with caveats>

### Should You Call First?
<Yes + 2-3 specific questions to ask, or "No - the posting is clear enough">

### Company Research Checklist
- [ ] Company website (mission, values, recent news)
- [ ] Review sites (Glassdoor, local equivalents)
- [ ] LinkedIn (team size, recent hires, mutual connections)
- [ ] Media (restructuring, growth, workplace issues)
- [ ] Network contacts who may know the team or manager`;

  const user = `CANDIDATE PROFILE:
${renderProfile(profile)}

JOB POSTING${jobUrl ? ` (source: ${jobUrl})` : ""}:
"""
${jobText}
"""

Produce the structured fit evaluation now.`;

  return { system, user };
}

/**
 * Step 3 - Cover letter (mirrors 03-writing-style.md + 06-cover-letter-templates.md).
 */
export function buildCoverLetterPrompt({ profile, jobText, jobUrl, format = "text" }) {
  const latexNote =
    format === "latex"
      ? `Output a complete cover letter as PLAIN, readable prose paragraphs, then ALSO provide a LaTeX version compatible with the framework's cover.cls (XeLaTeX): use \\namesection, \\currentdate{\\today}, \\lettercontent{...} per paragraph, \\closing{...}, and \\signature{...}. Keep any \\begin{itemize} OUTSIDE of \\lettercontent{} blocks. Put the LaTeX inside a fenced \`\`\`latex code block after the prose version.`
      : `Output the cover letter as clean, readable prose paragraphs in Markdown (no LaTeX).`;

  const system = `You write outstanding, forward-looking cover letters that get interviews. ${LANGUAGE_RULE(profile)}

${WRITING_STYLE_RULES}

STRUCTURE (hard 1-page limit, 250-300 words of body text):
- Opening: state the role and immediately connect the candidate's background to it, specific to THIS company and role (not a template opener).
- Why this company (place early): reference the company's mission/values/market position using themes from the posting. Explain the fit in terms of what the candidate will contribute, not what they gain.
- Body (task-solving focus): lead with the most relevant experience; frame around which of the employer's tasks the candidate can solve and how (methods, tools, approach). Use a 3-5 item bullet list of concrete, outcome-oriented achievements. Include at least one example showing initiative. Keep the emphasis forward-looking; use past examples only to back forward-looking claims.
- Personal fit: 2-3 sentences on behavioral strengths and team contribution.
- Close: brief, confident, forward-looking. No begging, no over-enthusiasm.

Also craft an engaging, specific HEADLINE using the formula [title/education] + [relevant keyword from the posting]. Never a generic "Application for X".

${latexNote}`;

  const user = `CANDIDATE PROFILE:
${renderProfile(profile)}

JOB POSTING${jobUrl ? ` (source: ${jobUrl})` : ""}:
"""
${jobText}
"""

Write the tailored cover letter now. Start with the suggested headline on its own line, then the letter. If any bullet requires framing the candidate's experience as more than it is, flag it under a short "Stretch checks" note at the very end instead of asserting it.`;

  return { system, user };
}

/**
 * Step 2 - CV tailoring advice (mirrors 05-cv-templates.md).
 */
export function buildCvPrompt({ profile, jobText, jobUrl }) {
  const system = `You are a CV tailoring expert. Given a candidate profile and a target job posting, you produce concrete, copy-pasteable tailoring for the candidate's CV. You do NOT fabricate experience; you re-emphasise and reorder what the candidate actually has.

${WRITING_STYLE_RULES}

Return Markdown with these sections:
### Tailored Profile Statement
A 2-3 sentence elevator pitch customised to this role (this is the highest-impact edit).

### Skills to Foreground
Which of the candidate's skills to list first, and the exact keywords from the posting to mirror (only where the candidate genuinely has them).

### Experience Bullets (rewritten)
3-6 rewritten experience bullets, each starting with an action verb or bold label, specific with tools/numbers/outcomes, ordered by relevance to this posting.

### Section Order
Recommended CV section order for this role and why.

### ATS Keyword Check
The important keywords from the posting, marked [have] / [partial] / [missing] against the profile.

${LANGUAGE_RULE(profile)}`;

  const user = `CANDIDATE PROFILE:
${renderProfile(profile)}

JOB POSTING${jobUrl ? ` (source: ${jobUrl})` : ""}:
"""
${jobText}
"""

Produce the CV tailoring now.`;

  return { system, user };
}

/**
 * Step 4 - Interview prep (mirrors 07-interview-prep.md).
 */
export function buildInterviewPrompt({ profile, jobText, jobUrl }) {
  const system = `You are an interview coach. You prepare a candidate for a specific role using STAR structure (Situation, Task, Action, Result), keeping answers to 1-2 minutes and always specific.

${LANGUAGE_RULE(profile)}

Return Markdown with these sections:
### Likely Questions (with strategy)
6-9 questions this specific role/company would ask, each with a one-line strategy for answering.

### STAR Answers to Draft
For 3-4 of the most important questions, sketch a STAR answer scaffold using the candidate's actual experience (label S/T/A/R). Where the profile lacks detail, mark the gap the candidate must fill in.

### Tough Questions
Handle: "Why did you leave your last role?", "You lack <the biggest gap for this role>", "Why this company specifically?". Give a forward-looking, non-defensive approach for each, grounded in the candidate's profile.

### Questions to Ask the Interviewer
5-7 sharp questions covering the role, the team, tech/growth, and culture (culture questions help the candidate avoid a bad fit).

### 48-Hour Prep Checklist
A short, concrete checklist for the two days before the interview.`;

  const user = `CANDIDATE PROFILE:
${renderProfile(profile)}

JOB POSTING / ROLE${jobUrl ? ` (source: ${jobUrl})` : ""}:
"""
${jobText}
"""

Produce the interview prep now.`;

  return { system, user };
}

export const TASKS = {
  evaluate: buildEvaluatePrompt,
  "cover-letter": buildCoverLetterPrompt,
  cv: buildCvPrompt,
  interview: buildInterviewPrompt,
};
