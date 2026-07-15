// AI Job Search - frontend logic. No dependencies, no build step.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const TASK_META = {
  evaluate: {
    title: "Evaluate fit",
    desc: "Score a posting against your profile across skills, experience, culture, location, and career alignment, with a verdict and next steps.",
    endpoint: "evaluate",
    format: false,
  },
  "cover-letter": {
    title: "Cover letter",
    desc: "Draft a tailored, forward-looking cover letter that follows the framework's writing rules (no em-dashes, no cliches, one page).",
    endpoint: "cover-letter",
    format: true,
  },
  cv: {
    title: "Tailor CV",
    desc: "Get a tailored profile statement, reordered skills, rewritten experience bullets, and an ATS keyword check for this role.",
    endpoint: "cv",
    format: false,
  },
  interview: {
    title: "Interview prep",
    desc: "Likely questions, STAR answer scaffolds from your experience, tough-question strategies, and questions to ask the interviewer.",
    endpoint: "interview",
    format: false,
  },
};

// Profile fields (key -> label + input type)
const PROFILE_FIELDS = [
  ["name", "Full name", "text"],
  ["currentRole", "Current / most recent role", "text"],
  ["location", "Location (and commute range)", "text"],
  ["targetRoles", "Target roles", "text"],
  ["language", "Preferred application language", "text"],
  ["education", "Education", "textarea"],
  ["primarySkills", "Primary skills (strongest)", "textarea"],
  ["secondarySkills", "Secondary skills", "textarea"],
  ["experience", "Experience summary", "textarea"],
  ["achievements", "Notable achievements (with numbers)", "textarea"],
  ["careerGoals", "Career goals", "textarea"],
  ["energizingTasks", "Tasks that energize me", "textarea"],
  ["drainingTasks", "Tasks that drain me", "textarea"],
];

const PROFILE_KEY = "aijs_profile_v1";

let currentTask = "evaluate";

// --- Profile ---------------------------------------------------------------

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

function buildProfileForm() {
  const profile = loadProfile();
  const form = $("#profileForm");
  form.innerHTML = "";
  for (const [key, label, type] of PROFILE_FIELDS) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.textContent = label;
    const input =
      type === "textarea"
        ? Object.assign(document.createElement("textarea"), { rows: 3 })
        : Object.assign(document.createElement("input"), { type: "text" });
    input.id = `pf_${key}`;
    input.value = profile[key] || "";
    wrap.append(span, input);
    form.append(wrap);
  }
}

function readProfileForm() {
  const profile = {};
  for (const [key] of PROFILE_FIELDS) {
    const el = $(`#pf_${key}`);
    if (el && el.value.trim()) profile[key] = el.value.trim();
  }
  return profile;
}

function profileIsEmpty() {
  return Object.keys(loadProfile()).length === 0;
}

// --- Tabs ------------------------------------------------------------------

function switchTab(tab) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  if (tab === "profile") {
    $("#panel-work").classList.remove("active");
    $("#panel-profile").classList.add("active");
    return;
  }
  $("#panel-profile").classList.remove("active");
  $("#panel-work").classList.add("active");
  currentTask = tab;
  const meta = TASK_META[tab];
  $("#work-title").textContent = meta.title;
  $("#work-desc").textContent = meta.desc;
  $("#runBtn").textContent = "Run " + meta.title.toLowerCase();
  $("#formatField").hidden = !meta.format;
  updateProfileHint();
}

function updateProfileHint() {
  $("#profileHint").textContent = profileIsEmpty()
    ? "Tip: fill in the My profile tab first for a personalised result."
    : "";
}

// --- Markdown (tiny, self-contained) --------------------------------------

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;

  const flushTable = () => {
    const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      rows.push(lines[i]);
      i++;
    }
    if (rows.length < 2) {
      // not really a table; emit as paragraphs
      rows.forEach((r) => (html += `<p>${inlineMd(r)}</p>`));
      return;
    }
    const cells = (r) =>
      r
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
    const head = cells(rows[0]);
    html += "<table><thead><tr>";
    head.forEach((h) => (html += `<th>${inlineMd(h)}</th>`));
    html += "</tr></thead><tbody>";
    for (let r = 2; r < rows.length; r++) {
      html += "<tr>";
      cells(rows[r]).forEach((c) => (html += `<td>${inlineMd(c)}</td>`));
      html += "</tr>";
    }
    html += "</tbody></table>";
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      i++;
      let code = "";
      while (i < lines.length && !/^```/.test(lines[i])) {
        code += lines[i] + "\n";
        i++;
      }
      i++; // closing fence
      html += `<pre><code>${escapeHtml(code)}</code></pre>`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushTable();
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      // Model emits ## for titles and ### for sections; both are styled in CSS.
      const level = Math.min(Math.max(h[1].length, 2), 4);
      html += `<h${level}>${inlineMd(h[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      html += "<ul>";
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, "");
        item = item.replace(/^\[( |x|X)\]\s*/, (_m, c) =>
          c.trim() ? "☑ " : "☐ ",
        );
        html += `<li>${inlineMd(item)}</li>`;
        i++;
      }
      html += "</ul>";
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    html += `<p>${inlineMd(line)}</p>`;
    i++;
  }
  return html;
}

// --- API -------------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Request failed (${res.status}).`);
  }
  return data;
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const el = $("#status");
    el.classList.toggle("ok", data.configured);
    el.classList.toggle("off", !data.configured);
    el.title = data.configured
      ? `Ready (model: ${data.model})`
      : "Server has no API key configured";
  } catch {
    $("#status").classList.add("off");
  }
}

// --- Actions ---------------------------------------------------------------

async function fetchJob() {
  const url = $("#jobUrl").value.trim();
  if (!url) return;
  const btn = $("#fetchBtn");
  btn.disabled = true;
  btn.textContent = "Fetching...";
  try {
    const { text } = await api("/api/fetch-job", { url });
    $("#jobText").value = text;
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Fetch";
  }
}

async function run() {
  const meta = TASK_META[currentTask];
  const jobText = $("#jobText").value.trim();
  const jobUrl = $("#jobUrl").value.trim();
  if (!jobText && !jobUrl) {
    alert("Paste the job posting text or provide a URL first.");
    return;
  }
  const body = { profile: loadProfile(), jobText, jobUrl };
  if (meta.format) body.format = $("#format").value;

  const out = $("#output");
  const runBtn = $("#runBtn");
  runBtn.disabled = true;
  $("#copyBtn").hidden = true;
  out.innerHTML = `<p><span class="spinner"></span>Working on it. This can take 10-30 seconds.</p>`;

  try {
    const { result } = await api(`/api/${meta.endpoint}`, body);
    out.innerHTML = renderMarkdown(result);
    out.dataset.raw = result;
    $("#copyBtn").hidden = false;
  } catch (e) {
    out.innerHTML = `<p class="error-box">${escapeHtml(e.message)}</p>`;
  } finally {
    runBtn.disabled = false;
  }
}

function copyResult() {
  const raw = $("#output").dataset.raw || "";
  navigator.clipboard.writeText(raw).then(() => {
    const btn = $("#copyBtn");
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });
}

// --- Wire up ---------------------------------------------------------------

function init() {
  buildProfileForm();

  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)),
  );
  $("#runBtn").addEventListener("click", run);
  $("#fetchBtn").addEventListener("click", fetchJob);
  $("#copyBtn").addEventListener("click", copyResult);

  $("#saveProfile").addEventListener("click", () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(readProfileForm()));
    const s = $("#profileSaved");
    s.hidden = false;
    setTimeout(() => (s.hidden = true), 1500);
    updateProfileHint();
  });
  $("#clearProfile").addEventListener("click", () => {
    if (!confirm("Clear your saved profile from this browser?")) return;
    localStorage.removeItem(PROFILE_KEY);
    buildProfileForm();
    updateProfileHint();
  });

  switchTab("evaluate");
  checkHealth();
}

document.addEventListener("DOMContentLoaded", init);
