// Frenchirix review UI. No framework, no build step. See docs/review-ui.md.
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------------------
// small helpers

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

function fmtTime(ms, decimals = 0) {
  if (ms === null || ms === undefined || isNaN(ms)) return "–";
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  const ss = decimals ? s.toFixed(decimals).padStart(3 + decimals, "0") : String(Math.floor(s)).padStart(2, "0");
  return (neg ? "−" : "") + m + ":" + ss;
}

function fold(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem("frenchirix." + key));
    localStorage.setItem("frenchirix." + key, JSON.stringify(value));
  } catch (e) { return undefined; }
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error((body && body.error) || `${res.status} ${res.statusText}`);
  return body;
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function scoreDots(score) {
  const s = score || 0;
  return el("span", { class: "score", title: score ? `score ${score} of 5` : "no score" },
    el("span", { class: "on" }, "●".repeat(s)), el("span", { class: "off" }, "●".repeat(5 - s)));
}

const KINDS = ["dialogue", "monologue", "song"];
// Review marks (docs/review-ui.md, "Review marks"). The digit picks the category in the form.
const MARK_CATEGORIES = [
  ["translation", "the English is wrong: literal English, a gloss, or the subtitle English"],
  ["french", "the French is not what is said"],
  ["units", "the split into units, a unit's kind, gloss or note"],
  ["timing", "a unit or the line plays the wrong sound"],
  ["notes", "a note for a child is wrong or missing"],
  ["other", "anything else: say what in the comment"],
];

// ---------------------------------------------------------------------------
// state

const state = {
  episodes: [],
  episode: null,        // episode payload with line spans
  scenes: [],           // scene summaries of the episode
  sceneId: null,
  scene: null,          // detail payload of the open scene
  filters: Object.assign({ q: "", kind: "", score: 0, tag: "", noted: false, marked: false, sort: "time" }, store("filters") || {}),
  hideEnglish: !!store("hideEnglish"),
  slow: !!store("slow"),
  showSubs: !!store("showSubs"),      // subtitle French and English under annotated lines
  glosses: !!store("glosses"),        // each unit's gloss under it
  vocabWords: !!store("vocabWords"),  // breakdown list narrowed to word units
  revealed: new Set(),  // mask keys revealed while English is hidden (see maskable)
  subsOpen: new Set(),  // line ids whose subtitles are opened one by one
  selUnit: null,        // [line index, unit index] of the selected unit
  loadToken: 0,
  marks: [],            // open review marks of every episode
  side: store("side") === "marks" ? "marks" : "scenes",  // what the sidebar shows
  marksEpisode: store("marksEpisode") || "",             // "" = every episode
  markForm: null,       // { line: line index, id: mark id being edited or null }
  markCategory: store("markCategory") || "translation",  // preselected in a new mark
};

// ---------------------------------------------------------------------------
// line and unit times (see docs/review-ui.md, "What it shows")

// Margins around a unit when it is played alone. Aligned word ends tend to fall on the
// last sound's onset, so the tail is longer than the lead.
const UNIT_LEAD_MS = 120;
const UNIT_TAIL_MS = 200;
// While following playback, a line or unit stays highlighted this long after its
// aligned end, so short pauses between words do not make the highlight flicker.
const LINE_HOLD_MS = 300;
const UNIT_HOLD_MS = 250;
// Units whose weakest word aligned below this score are flagged to be checked by ear.
// Provisional: chosen before the aligner's scores on this show were measured.
const LOW_SCORE = 0.5;

// Where a line is spoken: aligned audio times where they exist, else subtitle times.
function lineSpan(l) {
  if (l.offset_audio_start_ms !== null && l.offset_audio_end_ms !== null) {
    return { a: l.offset_audio_start_ms, z: l.offset_audio_end_ms, aligned: true };
  }
  return { a: l.offset_start_ms, z: l.offset_end_ms, aligned: false };
}

// Playing a line starts this much before it: subtitle times only roughly mark where
// speech starts; aligned times are close.
function lineLead(l) { return lineSpan(l).aligned ? UNIT_LEAD_MS : LINE_LEAD_MS; }

const isAnnotated = (l) => l.fr_final !== null;
const unitTimed = (u) => u.start_ms !== null;

// Why a timed unit's timing deserves a check by ear, or null.
function unitDoubt(u) {
  if (!unitTimed(u)) return null;
  if (u.score === null) return "aligned without a score";
  const parts = [];
  if (u.score < LOW_SCORE) parts.push(`alignment score ${u.score.toFixed(2)}`);
  if (u.unscored_words) parts.push(`${u.unscored_words} word${u.unscored_words > 1 ? "s" : ""} aligned without a score`);
  return parts.length ? parts.join("; ") : null;
}

// English that hide-English mode masks. Elements sharing a key are revealed together.
function maskable(key, node) {
  node.dataset.mask = key;
  if (state.hideEnglish && !state.revealed.has(key) && !node.classList.contains("none")) node.classList.add("masked");
  node.addEventListener("click", (ev) => {
    if (!node.classList.contains("masked")) return;
    ev.stopPropagation();
    state.revealed.add(key);
    for (const n of document.querySelectorAll(`[data-mask="${CSS.escape(key)}"]`)) n.classList.remove("masked");
  });
  return node;
}

// ---------------------------------------------------------------------------
// episode timeline

function renderTimeline() {
  const ep = state.episode;
  const lanesBox = $("#tl-lanes"), linesBox = $("#tl-lines"), axis = $("#tl-axis");
  lanesBox.replaceChildren(); linesBox.replaceChildren(); axis.replaceChildren();
  if (!ep) return;
  const extent = ep.story_end_ms;
  const pct = (ms) => (100 * ms / extent) + "%";

  // Greedy lane packing on the core span. A small gap keeps neighbours that nearly
  // touch on separate lanes only when they truly overlap.
  const sorted = [...state.scenes].sort((a, b) => a.core_start_ms - b.core_start_ms || a.core_end_ms - b.core_end_ms);
  const laneEnds = [];
  const lane = new Map();
  for (const s of sorted) {
    let i = laneEnds.findIndex((end) => end <= s.core_start_ms);
    if (i < 0) { i = laneEnds.length; laneEnds.push(0); }
    laneEnds[i] = s.core_end_ms;
    lane.set(s.id, i);
  }
  const nLanes = Math.max(1, laneEnds.length);
  const laneH = nLanes <= 2 ? 26 : nLanes <= 4 ? 18 : 14;
  lanesBox.style.height = (nLanes * laneH + 8) + "px";

  const visible = new Set(filteredScenes().map((s) => s.id));
  for (const s of sorted) {
    const h = { 5: 1, 4: 0.78, 3: 0.58, 2: 0.44, 1: 0.32 }[s.score] || 0.5;
    const b = el("button", {
      type: "button",
      class: `tl-scene k-${s.kind}` + (openMarks(s) ? " marked" : "") + (visible.has(s.id) ? "" : " filtered-out") + (s.id === state.sceneId ? " selected" : ""),
      style: `left:${pct(s.core_start_ms)};width:${pct(s.core_end_ms - s.core_start_ms)};` +
             `bottom:${(nLanes - 1 - lane.get(s.id)) * laneH + 4}px;height:${Math.round((laneH - 4) * h)}px`,
      dataset: { id: s.id },
      "aria-label": `${s.title}, ${s.kind}, score ${s.score}` + (openMarks(s) ? `, ${openMarks(s)} open marks` : ""),
    });
    b.addEventListener("click", () => openScene(s.id));
    b.addEventListener("mouseenter", (ev) => showTip(ev, s));
    b.addEventListener("mousemove", moveTip);
    b.addEventListener("mouseleave", hideTip);
    lanesBox.append(b);
  }
  // Padding window of the open scene, and the playhead while it plays.
  const cur = state.scenes.find((s) => s.id === state.sceneId);
  if (cur && cur.clip_start_ms !== null) {
    lanesBox.prepend(el("div", { class: "tl-clip", style: `left:${pct(cur.clip_start_ms)};width:${pct(cur.clip_end_ms - cur.clip_start_ms)}` }));
  }
  lanesBox.append(el("div", { class: "tl-playhead", id: "tl-playhead", hidden: true }));

  for (const [a, z] of ep.lines) {
    if (a > extent) break;
    linesBox.append(el("i", { style: `left:${pct(a)};width:${pct(Math.max(0, z - a))}` }));
  }
  // Minute ticks; labels every 2 or 5 minutes depending on the extent.
  const minutes = extent / 60000;
  const every = minutes > 40 ? 5 : 2;
  for (let m = 0; m * 60000 <= extent; m++) {
    axis.append(el("span", { class: m % every ? "minor" : "", style: `left:${pct(m * 60000)}` }, m % every ? "" : m + ":00"));
  }

  const legend = $("#tl-legend");
  const hidden = ep.duration_ms - extent;
  legend.replaceChildren(
    ...KINDS.map((k) => el("span", {}, el("span", { class: "sw", style: `background:var(--k-${k})` }), k)),
    el("span", {}, el("span", { class: "bars" }, el("i", { style: "height:58%" }), el("i", { style: "height:78%" }), el("i", { style: "height:100%" })), "score 3 · 4 · 5"),
    el("span", {}, el("span", { class: "mark-dot" }), "open marks"),
    el("span", { class: "spacer" }),
    el("span", {}, hidden > 30000
      ? `0:00 – ${fmtTime(extent)} shown · ${fmtTime(hidden)} of credits after the last line omitted`
      : `0:00 – ${fmtTime(extent)}`),
  );
}

function updateTimelineSelection() {
  for (const b of document.querySelectorAll(".tl-scene")) {
    b.classList.toggle("selected", b.dataset.id === state.sceneId);
  }
}

function updateTimelinePlayhead(clipMs) {
  const ph = document.getElementById("tl-playhead");
  if (!ph || !state.episode) return;
  const m = state.scene && state.scene.media;
  if (!m || clipMs === null) { ph.hidden = true; return; }
  ph.hidden = false;
  ph.style.left = (100 * (m.clip_start_ms + clipMs) / state.episode.story_end_ms) + "%";
}

function showTip(ev, s) {
  const tip = $("#tip");
  tip.replaceChildren(
    el("div", { class: "tt" }, s.title),
    el("div", {}, `${s.kind} · score ${s.score ?? "–"}` + (openMarks(s) ? ` · ${openMarks(s)} open mark${openMarks(s) > 1 ? "s" : ""}` : "")),
    el("div", {}, `${fmtTime(s.core_start_ms)} – ${fmtTime(s.core_end_ms)} · ${((s.core_end_ms - s.core_start_ms) / 1000).toFixed(1)} s` + (s.rendered ? "" : " · not rendered")),
  );
  tip.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const tip = $("#tip");
  const w = tip.offsetWidth;
  tip.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 12) + "px";
  tip.style.top = (ev.clientY + 16) + "px";
}
function hideTip() { $("#tip").hidden = true; }

// ---------------------------------------------------------------------------
// scene list and filters

function filteredScenes() {
  const f = state.filters;
  const q = fold(f.q.trim());
  let list = state.scenes.filter((s) =>
    (!f.kind || s.kind === f.kind) &&
    (!f.score || (s.score || 0) >= f.score) &&
    (!f.marked || openMarks(s) > 0) &&
    (!f.tag || s.tags.includes(f.tag)) &&
    (!f.noted || s.notes > 0) &&
    (!q || fold(s.title + "\n" + s.fr + "\n" + s.en + "\n" + (s.final || "")).includes(q)));
  if (f.sort === "score") {
    list = [...list].sort((a, b) => (b.score || 0) - (a.score || 0) || a.core_start_ms - b.core_start_ms);
  }
  return list;
}

// The full list in the current sort order, ignoring filters: next/previous from a scene
// that a filter just hid (e.g. after resolving its last mark) still works.
function orderedScenes() {
  const all = [...state.scenes];
  if (state.filters.sort === "score") all.sort((a, b) => (b.score || 0) - (a.score || 0) || a.core_start_ms - b.core_start_ms);
  return all;
}

function renderList() {
  const list = filteredScenes();
  const ol = $("#scene-list");
  ol.replaceChildren();
  if (!list.length) ol.append(el("li", { class: "empty-list" }, state.scenes.length ? "No scene matches these filters." : "This episode has no scenes yet."));
  for (const s of list) {
    const first = s.fr.length > 90 ? s.fr.slice(0, 90) + "…" : s.fr;
    const li = el("li", { class: `k-${s.kind}` + (s.id === state.sceneId ? " selected" : ""), dataset: { id: s.id } },
      el("span", { class: "kbar" }),
      el("span", { class: "t", title: s.title }, s.title),
      el("span", { class: "right" },
        el("span", {}, s.notes ? el("span", { class: "x-ic", title: `${s.notes} note${s.notes > 1 ? "s" : ""} on references or wordplay` }, "※ ") : null,
          openMarks(s) ? el("span", { class: "mark-ic", title: `${openMarks(s)} open review mark${openMarks(s) > 1 ? "s" : ""}` }, "⚑" + openMarks(s) + " ") : null, scoreDots(s.score)),
        el("span", {}, s.rendered ? fmtTime(s.core_start_ms) : el("span", { class: "nomedia", title: "not rendered yet" }, "no media · " + fmtTime(s.core_start_ms)))),
      el("span", { class: "sub" }, first));
    li.addEventListener("click", () => openScene(s.id));
    ol.append(li);
  }
  const f = state.filters;
  $("#f-count").textContent = list.length === state.scenes.length ? `${list.length} scenes` : `${list.length} of ${state.scenes.length}`;
  $("#f-clear").hidden = !(f.q || f.kind || f.score || f.tag || f.noted || f.marked);
  // Offered only when the episode has notes, or open marks, at all.
  const anyX = state.scenes.some((s) => s.notes);
  $("#f-noted-row").hidden = !anyX && !f.noted;
  $("#f-marked-row").hidden = !state.scenes.some(openMarks) && !f.marked;
  for (const b of document.querySelectorAll("[data-sort]")) b.classList.toggle("on", b.dataset.sort === f.sort);
  const sel = ol.querySelector("li.selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function renderStats() {
  const s = state.scenes;
  const rendered = s.filter((x) => x.rendered).length;
  const ep = state.episode ? state.episode.id : null;
  const marks = state.marks.filter((m) => m.episode_id === ep).length;
  $("#ep-stats").replaceChildren(
    el("b", {}, s.length), " scenes · ",
    marks ? el("span", { class: "mk" }, `${marks} open mark${marks > 1 ? "s" : ""}`) : "no open marks",
    rendered < s.length ? ` · ${rendered}/${s.length} rendered` : "");
}

function fillTagFilter() {
  const tags = [...new Set(state.scenes.flatMap((s) => s.tags))].sort();
  const sel = $("#f-tag");
  const cur = state.filters.tag;
  sel.replaceChildren(el("option", { value: "" }, "any"), ...tags.map((t) => el("option", { value: t }, t)));
  if (cur && !tags.includes(cur)) state.filters.tag = "";
  sel.value = state.filters.tag;
}

function syncFilterInputs() {
  const f = state.filters;
  $("#f-q").value = f.q; $("#f-kind").value = f.kind; $("#f-score").value = String(f.score);
  $("#f-tag").value = f.tag; $("#f-noted").checked = !!f.noted; $("#f-marked").checked = !!f.marked;
}

function filtersChanged() {
  store("filters", state.filters);
  renderList();
  const visible = new Set(filteredScenes().map((s) => s.id));
  for (const b of document.querySelectorAll(".tl-scene")) b.classList.toggle("filtered-out", !visible.has(b.dataset.id));
}

function bindFilters() {
  const f = state.filters;
  $("#f-q").addEventListener("input", (e) => { f.q = e.target.value; filtersChanged(); });
  $("#f-kind").addEventListener("change", (e) => { f.kind = e.target.value; filtersChanged(); });
  $("#f-score").addEventListener("change", (e) => { f.score = Number(e.target.value); filtersChanged(); });

  $("#f-tag").addEventListener("change", (e) => { f.tag = e.target.value; filtersChanged(); });
  $("#f-noted").addEventListener("change", (e) => { f.noted = e.target.checked; filtersChanged(); });
  $("#f-marked").addEventListener("change", (e) => { f.marked = e.target.checked; filtersChanged(); });
  for (const b of document.querySelectorAll("[data-sort]")) {
    b.addEventListener("click", () => { f.sort = b.dataset.sort; filtersChanged(); });
  }
  $("#f-clear").addEventListener("click", () => {
    Object.assign(f, { q: "", kind: "", score: 0, tag: "", noted: false, marked: false });
    syncFilterInputs(); filtersChanged();
  });
}

// ---------------------------------------------------------------------------
// player: audio is the master clock, the silent video follows it

const player = {
  audio: null,
  video: null,
  raf: 0,
  activeLine: -1,
  activeUnit: "",
  stopAt: null,         // clip ms where a unit being played alone stops
  dragging: false,

  attach(audio, video) {
    this.detach();
    this.audio = audio;
    this.video = video;
    this.activeLine = -1;
    this.activeUnit = "";
    this.stopAt = null;
    const a = audio, v = video;
    const rate = state.slow ? 0.75 : 1;
    a.playbackRate = rate;
    if (v) v.playbackRate = rate;
    a.addEventListener("play", () => { if (v) { v.currentTime = a.currentTime; v.play().catch(() => {}); } this.loop(); updatePlayButton(); });
    a.addEventListener("pause", () => { this.stopAt = null; if (v) { v.pause(); v.currentTime = a.currentTime; } updatePlayButton(); this.tick(); });
    // Backup for the frame loop, which the browser throttles in a hidden tab.
    a.addEventListener("timeupdate", () => this.checkStop());
    a.addEventListener("seeking", () => { if (v) v.currentTime = a.currentTime; this.tick(); });
    a.addEventListener("waiting", () => { if (v) v.pause(); });
    a.addEventListener("playing", () => { if (v && v.paused) v.play().catch(() => {}); });
    a.addEventListener("ratechange", () => { if (v) v.playbackRate = a.playbackRate; });
    a.addEventListener("ended", () => { updatePlayButton(); this.tick(); });
    a.addEventListener("loadedmetadata", () => this.tick());
    a.addEventListener("error", () => mediaError("audio", a));
    if (v) v.addEventListener("error", () => mediaError("video", v));
  },

  detach() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.backup);
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); }
    if (this.video) { this.video.pause(); this.video.removeAttribute("src"); this.video.load(); }
    this.audio = this.video = null;
  },

  loop() {
    cancelAnimationFrame(this.raf);
    // The browser can slow animation frames to one a second (an occluded window, and
    // headless Chromium after a while) while timers keep running. A timer then stands
    // in, so a unit still stops on time and the highlight still follows.
    clearInterval(this.backup);
    this.lastStep = performance.now();
    this.backup = setInterval(() => {
      const a = this.audio;
      if (!a || a.paused) { clearInterval(this.backup); return; }
      if (performance.now() - this.lastStep > 60) { this.checkStop(); this.tick(); }
    }, 30);
    const step = () => {
      const a = this.audio, v = this.video;
      if (!a) return;
      this.lastStep = performance.now();
      if (v && !a.paused && v.readyState >= 2) {
        // Keep the slideshow on the audio clock. Small drift is corrected by nudging
        // the rate; anything larger by a seek (cheap: the video is a few still frames).
        const drift = v.currentTime - a.currentTime;
        if (Math.abs(drift) > 0.12) {
          v.currentTime = a.currentTime;
          v.playbackRate = a.playbackRate;
        } else if (Math.abs(drift) > 0.03) {
          v.playbackRate = a.playbackRate * (drift > 0 ? 0.92 : 1.08);
        } else if (v.playbackRate !== a.playbackRate) {
          v.playbackRate = a.playbackRate;
        }
        if (v.paused && !v.ended) v.play().catch(() => {});
      }
      this.checkStop();
      this.tick();
      if (!a.paused) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },

  // Redraw everything that depends on the playback position.
  tick() {
    const a = this.audio;
    const sc = state.scene;
    if (!a || !sc || !sc.media) return;
    const ms = a.currentTime * 1000;
    const dur = sc.media.clip_end_ms - sc.media.clip_start_ms;
    const p = Math.max(0, Math.min(100, 100 * ms / dur));
    const ph = $("#ct-playhead"), played = $("#ct-played");
    if (ph) ph.style.left = p + "%";
    if (played) played.style.width = p + "%";
    const t = $("#ct-time");
    if (t) t.textContent = `${fmtTime(ms, 1)} / ${fmtTime(dur, 1)}`;
    updateTimelinePlayhead(a.paused && ms === 0 ? null : ms);
    // The line being spoken: the latest-starting line whose span contains the time.
    // Aligned lines use their audio span and stay lit briefly after it.
    let idx = -1;
    sc.lines.forEach((l, i) => {
      const s = lineSpan(l);
      if (s.a !== null && ms >= s.a && ms < s.z + (s.aligned ? LINE_HOLD_MS : 0)) idx = i;
    });
    if (idx !== this.activeLine) { this.activeLine = idx; highlightLine(idx); }
    // The unit being spoken: the latest-starting timed unit whose span (plus a short
    // hold) contains the time.
    let uk = "";
    if (!(a.paused && ms === 0)) {
      sc.lines.forEach((l, i) => l.units.forEach((u, j) => {
        if (u.offset_start_ms !== null && ms >= u.offset_start_ms && ms < u.offset_end_ms + UNIT_HOLD_MS) uk = `${i}:${j}`;
      }));
    }
    if (uk !== this.activeUnit) {
      this.activeUnit = uk;
      for (const n of document.querySelectorAll("[data-u].speaking")) n.classList.remove("speaking");
      if (uk) for (const n of document.querySelectorAll(`[data-u="${uk}"]`)) n.classList.add("speaking");
    }
  },

  checkStop() {
    const a = this.audio;
    if (a && this.stopAt !== null && !a.paused && a.currentTime * 1000 >= this.stopAt) a.pause();
  },

  toggle() {
    const a = this.audio;
    if (!a) return;
    this.stopAt = null;
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      a.play().catch(playFailed);
    } else a.pause();
  },

  seek(ms) {
    const a = this.audio;
    if (!a) return;
    const s = Math.max(0, ms / 1000);
    this.stopAt = null;
    a.currentTime = s;
    if (this.video) this.video.currentTime = s;
    this.tick();
  },

  playFrom(ms) {
    this.seek(ms);
    if (this.audio && this.audio.paused) this.audio.play().catch(playFailed);
  },

  // Play [fromMs, toMs) of the clip, then pause.
  playSpan(fromMs, toMs) {
    this.playFrom(fromMs);
    this.stopAt = toMs;
  },
};

// Clicking a line starts slightly before its subtitle time: subtitles only roughly mark
// where speech starts (see the guard in docs/media.md).
const LINE_LEAD_MS = 250;

function playLine(i) {
  const sc = state.scene;
  if (!sc || !sc.media || !player.audio || i < 0 || i >= sc.lines.length) return;
  const l = sc.lines[i];
  player.playFrom(Math.max(0, lineSpan(l).a - lineLead(l)));
}

// Select a unit and, when it has times and the scene has audio, play just its span.
function playUnit(i, j) {
  const sc = state.scene;
  const u = sc && sc.lines[i] && sc.lines[i].units[j];
  if (!u) return;
  selectUnit(i, j);
  if (u.offset_start_ms === null || !sc.media || !player.audio) return;
  player.playSpan(Math.max(0, u.offset_start_ms - UNIT_LEAD_MS), u.offset_end_ms + UNIT_TAIL_MS);
}

// , and . step through the scene's units from the selected one, or from the playhead.
function stepUnit(delta) {
  const sc = state.scene;
  if (!sc) return;
  const all = [];
  sc.lines.forEach((l, i) => l.units.forEach((u, j) => all.push([i, j, u])));
  if (!all.length) return;
  let k;
  if (state.selUnit) {
    k = all.findIndex(([i, j]) => i === state.selUnit[0] && j === state.selUnit[1]) + delta;
  } else {
    const ms = player.audio ? player.audio.currentTime * 1000 : 0;
    k = all.findIndex(([, , u]) => u.offset_start_ms !== null && u.offset_start_ms >= ms);
    if (k < 0) k = all.length;
    if (delta < 0) k -= 1;
  }
  k = Math.max(0, Math.min(all.length - 1, k));
  playUnit(all[k][0], all[k][1]);
}

function currentLineIndex() {
  const sc = state.scene;
  if (!sc || !player.audio) return -1;
  const ms = player.audio.currentTime * 1000;
  let idx = -1;
  sc.lines.forEach((l, i) => { if (lineSpan(l).a - lineLead(l) - 50 <= ms) idx = i; });
  return idx;
}

// A play() cut short by a pause (a unit that ends at once, a quick second click) is
// not an error worth a message.
function playFailed(e) {
  if (e && e.name === "AbortError") return;
  toast("Cannot play: " + e.message);
}

function mediaError(kind, node) {
  const codes = { 1: "aborted", 2: "network error", 3: "decode error", 4: "format not supported" };
  const code = node.error ? node.error.code : 0;
  if (!node.getAttribute("src")) return;
  const box = $(".video-box");
  if (box && !box.querySelector(".media-err")) box.append(el("div", { class: "media-err" }, `${kind} failed to load: ${codes[code] || "error " + code}`));
}

function updatePlayButton() {
  const b = $("#play");
  if (!b || !player.audio) return;
  const playing = !player.audio.paused;
  b.replaceChildren(playing ? svgIcon("M5 3h4v14H5zM11 3h4v14h-4z") : svgIcon("M5 3l12 7-12 7z"));
  b.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function svgIcon(d) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 20 20");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}

function highlightLine(idx) {
  const sc = state.scene;
  for (const n of document.querySelectorAll(".ln-fr.active, .ln-gutter.active, .ln-en.active, .ct-line.active")) n.classList.remove("active");
  if (idx < 0 || !sc) return;
  const line = sc.lines[idx];
  for (const n of document.querySelectorAll(`[data-line="${idx}"]`)) n.classList.add("active");
  const en = document.querySelector(`.ln-en[data-group="${line.group_idx}"]`);
  if (en) en.classList.add("active");
  const fr = document.querySelector(`.ln-fr[data-line="${idx}"]`);
  if (fr && player.audio && !player.audio.paused) fr.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// scene pane

function whyNode(text) {
  // Quoted French in the selector's reason ('…') is set off visually. An opening
  // quote must follow a space or bracket, so apostrophes inside words are left alone.
  const p = el("p");
  if (!text) { p.append(el("span", { class: "muted" }, "No reason recorded.")); return p; }
  const re = /(^|[\s(\[“"])'(.+?)'(?=[\s.,;:!?)\]]|$)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    p.append(text.slice(last, start), el("q", {}, m[2]));
    last = start + m[2].length + 2;
  }
  p.append(text.slice(last));
  return p;
}

function clipTimeline(sc) {
  const m = sc.media;
  const dur = m.clip_end_ms - m.clip_start_ms;
  const pct = (ms) => (100 * Math.max(0, Math.min(dur, ms)) / dur) + "%";
  const coreA = sc.core_start_ms - m.clip_start_ms;
  const coreZ = sc.core_end_ms - m.clip_start_ms;
  const fadeInEnd = m.fade_in_ms;
  const fadeOutStart = dur - m.fade_out_ms;

  const track = el("div", { class: "ct-track", id: "ct-track", title: "Click or drag to seek" },
    el("div", { class: "ct-region ct-fade-in", style: `left:0;width:${pct(fadeInEnd)}` }),
    el("div", { class: "ct-region ct-guard", style: `left:${pct(fadeInEnd)};width:${pct(coreA - fadeInEnd)}` }),
    el("div", { class: "ct-region ct-core", style: `left:${pct(coreA)};width:${pct(coreZ - coreA)}` }),
    el("div", { class: "ct-region ct-guard", style: `left:${pct(coreZ)};width:${pct(fadeOutStart - coreZ)}` }),
    el("div", { class: "ct-region ct-fade-out", style: `left:${pct(fadeOutStart)};width:${pct(m.fade_out_ms)}` }),
    el("div", { class: "ct-played", id: "ct-played" }),
    ...m.frame_times_ms.map((t) => el("div", { class: "ct-frame", style: `left:${pct(t)}`, title: `slide at ${fmtTime(t, 1)}` })),
    el("div", { class: "ct-playhead", id: "ct-playhead", style: "left:0" }));

  // Gain envelope: half-sine S-curves over the fades, flat at full volume between.
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "ct-env");
  svg.setAttribute("viewBox", `0 0 ${dur} 100`);
  svg.setAttribute("preserveAspectRatio", "none");
  const pts = [];
  const N = 24;
  for (let i = 0; i <= N; i++) { const x = fadeInEnd * i / N; pts.push([x, 100 - 100 * (0.5 - 0.5 * Math.cos(Math.PI * i / N))]); }
  for (let i = 0; i <= N; i++) { const x = fadeOutStart + m.fade_out_ms * i / N; pts.push([x, 100 * (0.5 - 0.5 * Math.cos(Math.PI * i / N))]); }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L"));
  svg.append(path);
  track.append(svg);

  const seekAt = (ev) => {
    const r = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    player.seek(f * dur);
  };
  track.addEventListener("pointerdown", (ev) => { player.dragging = true; track.setPointerCapture(ev.pointerId); seekAt(ev); });
  track.addEventListener("pointermove", (ev) => { if (player.dragging) seekAt(ev); });
  track.addEventListener("pointerup", () => { player.dragging = false; });

  const lines = el("div", { class: "ct-lines" },
    ...sc.lines.map((l, i) => {
      const s = lineSpan(l);
      return el("div", {
        class: "ct-line" + (l.is_song ? " song" : ""), dataset: { line: i },
        style: `left:${pct(s.a)};width:${pct(s.z) === pct(s.a) ? "2px" : `calc(${pct(s.z)} - ${pct(s.a)} - 1px)`}`,
        title: `line ${l.idx}${s.aligned ? " (aligned)" : ""}: ${l.fr_final ?? l.fr}`, onclick: () => playLine(i) });
    }));

  // Core start and end; the clip end only where it does not collide (the total length
  // is also in the time readout).
  const labels = el("div", { class: "ct-labels" },
    el("span", { style: `left:${pct(coreA)}`, title: "core start" }, fmtTime(coreA, 1)),
    coreZ - coreA > dur * 0.15 ? el("span", { style: `left:${pct(coreZ)}`, title: "core end" }, fmtTime(coreZ, 1)) : null,
    coreZ / dur < 0.85 ? el("span", { class: "r", style: "left:100%", title: "clip end" }, fmtTime(dur, 1)) : null);

  const legend = el("div", { class: "ct-legend" },
    el("span", { title: "fade in / fade out" }, el("i", { style: "background:linear-gradient(90deg,transparent,var(--fade))" }), `fade ${(m.fade_in_ms / 1000).toFixed(1)} / ${(m.fade_out_ms / 1000).toFixed(1)} s`),
    el("span", {}, el("i", { style: "background:var(--guard)" }), "guard (full volume)"),
    el("span", {}, el("i", { style: "background:var(--core)" }), `core ${((coreZ - coreA) / 1000).toFixed(1)} s`),
    el("span", {}, "| = slide"));
  return el("div", { class: "cliptl" }, track, lines, labels, legend);
}

// The French of a line, [a, z) of fr_final, with the words the subtitle does not have
// wrapped so that comparison mode can mark them.
// The phrases a note is about are tinted, with a numbered marker after each.
function finalText(l, a, z) {
  const frag = document.createDocumentFragment();
  const xps = lineNotes(l).filter((x) => x.char_start !== null);
  const cuts = new Set([a, z]);
  for (const [s, e] of l.fr_added) { cuts.add(s); cuts.add(e); }
  for (const x of xps) { cuts.add(x.char_start); cuts.add(x.char_end); }
  const pts = [...cuts].filter((c) => c >= a && c <= z).sort((p, q) => p - q);
  for (let k = 0; k + 1 < pts.length; k++) {
    const p = pts[k], q = pts[k + 1];
    const add = l.fr_added.some(([s, e]) => s <= p && q <= e);
    const x = xps.find((x) => x.char_start <= p && q <= x.char_end);
    const text = l.fr_final.slice(p, q);
    frag.append(add || x ? el("span", { class: (add ? "add" : "") + (x ? ` xp k-${x.kind}` : ""), dataset: x ? { x: x.n } : {} }, text) : text);
    for (const xe of xps) if (xe.char_end === q) frag.append(xMarker(xe));
  }
  return frag;
}

// ---------------------------------------------------------------------------
// notes on references and wordplay

const X_KIND = { reference: "Reference", wordplay: "Wordplay" };

// The scene's notes that point into line l, each with its display number n.
function lineNotes(l) {
  const sc = state.scene;
  return sc && sc.notes ? sc.notes.filter((x) => x.line_id === l.id) : [];
}

function xMarker(x) {
  return el("button", {
    type: "button", class: `xref k-${x.kind}` + (x.char_start === null ? " unlocated" : ""), dataset: { x: x.n },
    title: `${X_KIND[x.kind]} ${x.n}` + (x.char_start === null ? ` (phrase “${x.phrase}” not located in the line)` : "") + ": go to the note",
    onclick: (ev) => { ev.stopPropagation(); flash(document.getElementById("xp-" + x.n)); },
  }, String(x.n));
}

function flash(node) {
  if (!node) return;
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  node.classList.remove("flash");
  void node.offsetWidth;
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1600);
}

function playNote(x) {
  const sc = state.scene;
  if (x.offset_start_ms === null || !sc.media || !player.audio) return;
  player.playSpan(Math.max(0, x.offset_start_ms - UNIT_LEAD_MS), x.offset_end_ms + UNIT_TAIL_MS);
}

// Teaching text for a child, kept apart from the selector's "why this scene".
function notesSection(sc) {
  if (!sc.notes.length) return null;
  const canPlay = !!(sc.media && sc.media.audio_exists);
  const cards = sc.notes.map((x) => {
    const i = sc.lines.findIndex((l) => l.id === x.line_id);
    const where = x.line_id === null ? el("span", { class: "x-where" }, "the whole scene")
      : el("button", { type: "button", class: "x-where link", title: "Show the phrase in its line",
        onclick: () => { const n = document.querySelector(`.xp[data-x="${x.n}"]`) || document.querySelector(`.ln-fr[data-line="${i}"]`); flash(n); } },
        x.char_start === null ? `line ${x.line_idx}, phrase not located ↑` : `line ${x.line_idx} ↑`);
    const timed = x.offset_start_ms !== null && canPlay;
    return el("div", { class: `xcard k-${x.kind}`, id: "xp-" + x.n },
      el("div", { class: "x-head" },
        el("span", { class: `x-num k-${x.kind}` }, String(x.n)),
        el("span", { class: "x-kind" }, X_KIND[x.kind]),
        x.phrase ? el(timed ? "button" : "span", {
          class: "x-phrase" + (timed ? " playable" : ""), lang: "fr",
          title: timed ? "Play this phrase" : x.start_ms === null && x.char_start !== null ? "Not aligned yet" : null,
          type: timed ? "button" : null, onclick: timed ? () => playNote(x) : null,
        }, timed ? "▶ " : "", x.phrase) : null,
        where),
      maskable("x:" + x.n, el("p", { class: "x-text m", lang: "en" }, x.text)));
  });
  return el("section", { class: "notes" },
    el("div", { class: "notes-h" }, el("h2", {}, "Explained for a child"),
      el("span", { class: "muted small" }, sc.notes.map((x) => x.kind).filter((k, q, a) => a.indexOf(k) === q).map((k) => X_KIND[k].toLowerCase()).join(" and "))),
    ...cards);
}

function unitKey(l, u) { return `u:${l.id}:${u.idx}`; }

function unitTitle(u, canPlay) {
  if (!unitTimed(u)) return "Not aligned yet: no times to play";
  const doubt = unitDoubt(u);
  return (canPlay ? "Play this unit" : "Times known; the scene has no audio") + (doubt ? ` · check by ear: ${doubt}` : "");
}

// A line's true French as its units. Text between units (spaces, punctuation, the
// "- " of a second speaker, lyric line breaks) is kept as it is in fr_final.
function unitsText(l, i, canPlay) {
  const span = el("span", { class: "txt" });
  let pos = 0;
  l.units.forEach((u, j) => {
    if (u.char_start > pos) span.append(finalText(l, pos, u.char_start));
    const doubt = unitDoubt(u);
    const sel = state.selUnit && state.selUnit[0] === i && state.selUnit[1] === j;
    const marked = lineMarks(l).some((m) => m.status === "open" && m.unit_idx === u.idx);
    span.append(el("span", {
      class: `u k-${u.kind}` + (unitTimed(u) ? "" : " untimed") + (doubt ? " doubt" : "") + (sel ? " sel" : "") + (marked ? " marked" : ""),
      dataset: { u: `${i}:${j}` }, title: unitTitle(u, canPlay) + (marked ? " · marked for fixing" : ""),
      onclick: (ev) => { ev.stopPropagation(); playUnit(i, j); },
    }, el("span", { class: "u-fr" }, finalText(l, u.char_start, u.char_end)),
      maskable(unitKey(l, u), el("span", { class: "u-gl m", lang: "en" }, u.en))));
    pos = u.char_end;
  });
  if (pos < l.fr_final.length) span.append(finalText(l, pos, l.fr_final.length));
  return span;
}

// Gloss, note and timing of the selected unit, under its line.
function unitDetail(l, u, canPlay) {
  const doubt = unitDoubt(u);
  const timing = unitTimed(u)
    ? (u.offset_start_ms !== null ? `${fmtTime(u.offset_start_ms, 1)}–${fmtTime(u.offset_end_ms, 1)}` : `${fmtTime(u.start_ms, 1)} in the episode`)
      + ` · ${((u.end_ms - u.start_ms) / 1000).toFixed(2)} s` + (u.score !== null ? ` · score ${u.score.toFixed(2)}` : "")
    : "not aligned";
  return el("div", { class: "u-detail", onclick: (ev) => ev.stopPropagation() },
    el("div", { class: "ud-head" },
      unitTimed(u) && canPlay ? el("button", { type: "button", class: "ud-play", title: "Play this unit again (or click it)",
        onclick: () => playUnit(state.selUnit[0], state.selUnit[1]) }, "▶") : null,
      el("span", { class: `ud-fr k-${u.kind}`, lang: "fr" }, u.text),
      el("span", { class: "ud-kind" }, u.kind),
      el("span", { class: "ud-time" }, timing),
      doubt ? el("span", { class: "ud-doubt" }, "check by ear: " + doubt) : null,
      el("button", { type: "button", class: "ud-mark", title: "Mark this unit as needing a fix (M)",
        onclick: () => openMarkForm(state.selUnit[0], { unitIdx: u.idx }) }, "⚑ Mark")),
    maskable(unitKey(l, u), el("div", { class: "ud-en m", lang: "en" }, u.en)),
    u.note ? maskable(unitKey(l, u), el("div", { class: "ud-note m", lang: "en" }, u.note)) : null);
}

function selectUnit(i, j) {
  state.selUnit = [i, j];
  const k = `${i}:${j}`;
  for (const n of document.querySelectorAll("[data-u].sel")) n.classList.remove("sel");
  for (const n of document.querySelectorAll(`[data-u="${k}"]`)) n.classList.add("sel");
  for (const n of document.querySelectorAll(".u-detail")) n.remove();
  const sc = state.scene;
  const cell = document.querySelector(`.ln-fr[data-line="${i}"]`);
  // Under the line, above its marks.
  if (cell && sc) cell.insertBefore(unitDetail(sc.lines[i], sc.lines[i].units[j], !!(sc.media && sc.media.audio_exists)), cell.querySelector(".marks-box"));
  const row = document.querySelector(`.vrow[data-u="${k}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

// The subtitle versions of an annotated line, shown in comparison mode (T) or when
// the line's ≠ mark is clicked.
function subFr(l) {
  return el("div", { class: "sub-cmp" }, el("span", { class: "lbl" }, "subtitle"),
    l.fr_differs ? el("span", { class: "sub-txt" }, l.fr) : el("span", { class: "same" }, "same words as the subtitle"));
}

function toggleLineSubs(i) {
  const l = state.scene.lines[i];
  const open = !state.subsOpen.has(l.id);
  if (open) state.subsOpen.add(l.id); else state.subsOpen.delete(l.id);
  for (const n of document.querySelectorAll(`.ln-fr[data-line="${i}"], .ln-en[data-line="${i}"]`)) n.classList.toggle("subs-open", open);
}

function linesGrid(sc) {
  const annotated = sc.lines.some(isAnnotated);
  const toggle = (id, label, title, checked, onchange) => el("label", { class: "toggle", title },
    el("input", { type: "checkbox", id, checked, onchange: (e) => onchange(e.target.checked) }), label);
  const grid = el("div", { class: "lines" + (annotated ? " annotated" : "") },
    el("div", { class: "lines-h fr-h", style: "grid-row:1;grid-column:2" },
      el("span", {}, annotated ? "French · as spoken" : "French"),
      annotated ? el("span", { class: "toggles" },
        toggle("show-gl", "Glosses", "Show each unit's English under it (G)", state.glosses, setGlosses),
        toggle("show-subs", "Subtitles", "Show the subtitle French and English under each line (T)", state.showSubs, setShowSubs)) : null),
    el("div", { class: "lines-h en-h", style: "grid-row:1;grid-column:3" }, el("span", {}, annotated ? "English · literal" : "English"),
      toggle("hide-en", "Hide", "Hide the English until clicked (E)", state.hideEnglish, setHideEnglish)));
  // Row 1 is the header; line i sits on grid row i + 2.
  const rowOf = new Map(sc.lines.map((l, i) => [l.idx, i + 2]));
  const canPlay = !!(sc.media && sc.media.audio_exists);
  sc.lines.forEach((l, i) => {
    const row = i + 2;
    const ann = isAnnotated(l);
    const span = lineSpan(l);
    const subsOpen = state.subsOpen.has(l.id);
    grid.append(
      el("div", { class: "ln-gutter", dataset: { line: i }, style: `grid-row:${row};grid-column:1`,
        title: canPlay ? `Play from this line${span.aligned ? " (aligned start)" : ""}` : `line ${l.idx}`, onclick: () => playLine(i) },
        canPlay ? fmtTime(span.a, 1) : fmtTime(l.start_ms),
        l.is_song ? el("span", { class: "song", title: "sung" }, "♪") : null,
        ann && l.fr_differs ? el("button", { type: "button", class: "diff-mark", title: "The spoken French differs from the subtitle: click to compare",
          onclick: (ev) => { ev.stopPropagation(); toggleLineSubs(i); } }, "≠") : null,
        ann && !span.aligned ? el("span", { class: "untimed-mark", title: "Annotated, not aligned yet: subtitle times, units cannot be played" }, "no timing") : null,
        markButton(l, i)),
      el("div", { class: "ln-fr" + (l.is_song ? " sung" : "") + (subsOpen ? " subs-open" : ""), lang: "fr", dataset: { line: i },
        style: `grid-row:${row};grid-column:2`, title: canPlay ? "Play from this line" : null, onclick: () => playLine(i) },
        l.speaker ? el("span", { class: "spk" }, l.speaker) : null,
        ann ? unitsText(l, i, canPlay) : el("span", { class: "txt" }, l.fr),
        ...lineNotes(l).filter((x) => x.char_start === null).map(xMarker),
        ann ? subFr(l) : null,
        state.selUnit && state.selUnit[0] === i && l.units[state.selUnit[1]] ? unitDetail(l, l.units[state.selUnit[1]], canPlay) : null,
        lineMarksBlock(l, i)));
  });
  for (const g of sc.groups) {
    const glines = sc.lines.filter((l) => l.group_idx === g.group_idx);
    const rows = glines.map((l) => rowOf.get(l.idx));
    if (!rows.length) continue;
    const a = Math.min(...rows), z = Math.max(...rows);
    if (glines.every(isAnnotated)) {
      // Literal English per line; the subtitle's English for the group goes under its
      // first line, for comparison.
      glines.forEach((l, k) => {
        const i = sc.lines.indexOf(l);
        const subEn = k > 0
          ? el("span", { class: "same" }, "one subtitle with the line above")
          : maskable("g:" + g.group_idx, el("span", { class: "sub-txt m" + (g.en ? "" : " none") }, g.en || "(no English subtitle)"));
        grid.append(maskable("l:" + l.id, el("div", {
          class: "ln-en lit" + (state.subsOpen.has(l.id) ? " subs-open" : ""), lang: "en", dataset: { line: i },
          style: `grid-row:${rowOf.get(l.idx)};grid-column:3`,
        }, el("span", { class: "en-txt" }, l.en_literal),
          el("div", { class: "sub-cmp" }, el("span", { class: "lbl" }, "subtitle"), subEn),
          k === 0 && g.partial ? el("span", { class: "partial-warn" }, "this translation group extends outside the scene") : null)));
      });
      continue;
    }
    // Not (fully) annotated: the subtitle's English, as before annotation existed. Any
    // literal English of annotated lines in the group is listed under it.
    const lits = glines.filter(isAnnotated);
    const cell = maskable("g:" + g.group_idx, el("div", {
      class: "ln-en" + (z > a ? " multi" : "") + (g.en ? "" : " none"),
      lang: "en", dataset: { group: g.group_idx },
      style: `grid-row:${a} / ${z + 1};grid-column:3`,
      title: z > a ? `one translation for ${z - a + 1} French lines` : null,
    }, el("span", { class: "en-txt" }, g.en || "(no English subtitle)"),
      annotated ? el("span", { class: "sub-flag" }, "subtitle") : null,
      ...lits.map((l) => el("span", { class: "lit-extra" }, `literal, line ${l.idx}: ${l.en_literal}`)),
      g.partial ? el("span", { class: "partial-warn" }, "this translation group extends outside the scene") : null));
    grid.append(cell);
  }
  return grid;
}

// Every unit of the scene in one list, with glosses and notes.
function vocabSection(sc) {
  const rows = [];
  const canPlay = !!(sc.media && sc.media.audio_exists);
  sc.lines.forEach((l, i) => l.units.forEach((u, j) => {
    const doubt = unitDoubt(u);
    rows.push(el("div", {
      class: `vrow k-${u.kind}` + (unitTimed(u) ? "" : " untimed") + (doubt ? " doubt" : ""),
      dataset: { u: `${i}:${j}` }, title: unitTitle(u, canPlay), onclick: () => playUnit(i, j),
    },
      el("span", { class: "v-time" }, unitTimed(u) && u.offset_start_ms !== null ? fmtTime(u.offset_start_ms, 1) : unitTimed(u) ? "" : "–"),
      el("span", { class: "v-fr", lang: "fr" }, el("span", { class: "u-fr" }, u.text)),
      el("span", { class: "v-en" },
        maskable(unitKey(l, u), el("span", { class: "v-gl m", lang: "en" }, u.en)),
        u.note ? maskable(unitKey(l, u), el("span", { class: "v-note m", lang: "en" }, u.note)) : null)));
  }));
  if (!rows.length) return null;
  const n = sc.lines.reduce((s, l) => s + l.units.length, 0);
  const nw = sc.lines.reduce((s, l) => s + l.units.filter((u) => u.kind === "word").length, 0);
  const sec = el("section", { class: "vocab" + (state.vocabWords ? " words-only" : "") },
    el("div", { class: "vocab-h" },
      el("h2", {}, "Breakdown"),
      el("span", { class: "muted small" }, `${n} units · ${nw} word${nw === 1 ? "" : "s"}`),
      el("div", { class: "seg", role: "group", "aria-label": "Units shown" },
        ...[[false, "All"], [true, "Words"]].map(([w, label]) => el("button", {
          type: "button", class: state.vocabWords === w ? "on" : "", dataset: { words: String(w) },
          onclick: () => setVocabWords(w) }, label))),
      el("span", { class: "vocab-legend" },
        el("span", { class: "lg-word" }, "word"), el("span", { class: "lg-expr" }, "expression"),
        el("span", { class: "lg-doubt" }, "check by ear"), el("span", { class: "lg-untimed" }, "not aligned"))),
    el("div", { class: "vlist" }, ...rows),
    nw === 0 ? el("div", { class: "v-empty muted small" }, "No word units in this scene.") : null);
  return sec;
}

function setVocabWords(on) {
  state.vocabWords = on;
  store("vocabWords", on);
  const sec = $(".vocab");
  if (!sec) return;
  sec.classList.toggle("words-only", on);
  for (const b of sec.querySelectorAll("[data-words]")) b.classList.toggle("on", b.dataset.words === String(on));
}

function setGlosses(on) {
  state.glosses = on;
  store("glosses", on);
  $("#scene").classList.toggle("show-gl", on);
  const cb = $("#show-gl");
  if (cb) cb.checked = on;
}

function setShowSubs(on) {
  state.showSubs = on;
  store("showSubs", on);
  $("#scene").classList.toggle("show-subs", on);
  const cb = $("#show-subs");
  if (cb) cb.checked = on;
}

function playerBlock(sc) {
  const m = sc.media;
  const box = el("div", { class: "video-box" });
  if (!m) {
    box.append(el("div", { class: "placeholder" },
      el("b", {}, "Not rendered yet"),
      el("span", {}, "The text is complete; audio and video appear once the scene is rendered."),
      el("code", {}, `.venv/bin/frenchirix render --scene ${sc.id}`)));
    return [box];
  }
  if (!m.audio_exists || !m.video_exists) {
    const missing = [!m.audio_exists && m.audio_url, !m.video_exists && m.video_url].filter(Boolean).join(", ");
    box.append(el("div", { class: "placeholder" },
      el("b", {}, "Media files missing"),
      el("span", {}, "The database says this scene is rendered, but these files are not on disk:"),
      el("code", {}, missing),
      el("code", {}, `.venv/bin/frenchirix render --scene ${sc.id} --force`)));
    if (!m.audio_exists) return [box, clipTimeline(sc)];
  }
  const v = m.video_exists ? el("video", { muted: true, playsinline: true, preload: "auto", src: m.video_url, "aria-label": "Slideshow" }) : null;
  if (v) { v.muted = true; box.append(v); }
  const a = el("audio", { preload: "auto", src: m.audio_url });
  const transport = el("div", { class: "transport" },
    el("button", { type: "button", class: "play", id: "play", "aria-label": "Play", title: "Play / pause (Space)", onclick: () => player.toggle() }),
    el("span", { class: "time", id: "ct-time" }, "0:00.0"),
    el("button", { type: "button", class: "speed" + (state.slow ? " on" : ""), id: "speed", title: "Slow playback (S)", onclick: toggleSlow }, "0.75×"),
    a);
  player.attach(a, v);
  return [box, transport, clipTimeline(sc)];
}

function toggleSlow() {
  state.slow = !state.slow;
  store("slow", state.slow);
  if (player.audio) player.audio.playbackRate = state.slow ? 0.75 : 1;
  const b = $("#speed");
  if (b) b.classList.toggle("on", state.slow);
}

function renderScene() {
  const sc = state.scene;
  const main = $("#scene");
  player.detach();
  if (!sc) {
    main.replaceChildren(el("div", { class: "empty" }, state.scenes.length ? "Pick a scene on the timeline or in the list." : "This episode has no scenes yet."));
    return;
  }
  const head = el("div", { class: "scene-head" },
    el("div", { class: "meta" },
      el("span", { class: `kind-badge k-${sc.kind}` }, sc.kind),
      scoreDots(sc.score),
      el("span", {}, `${fmtTime(sc.core_start_ms, 1)} – ${fmtTime(sc.core_end_ms, 1)}`),
      el("span", {}, `${sc.lines.length} line${sc.lines.length === 1 ? "" : "s"}`),
      el("span", { class: "mono" }, sc.id)),
    el("h1", { lang: "en" }, sc.title),
    el("div", { class: "tags" }, ...sc.tags.map((t) => el("button", { type: "button", class: "tag", title: "Show only scenes with this tag",
      onclick: () => { state.filters.tag = t; syncFilterInputs(); filtersChanged(); } }, "#" + t))));

  const playerCol = el("div", { class: "player-col" },
    ...playerBlock(sc),
    el("section", { class: "why" }, el("h2", {}, "Why this scene"), whyNode(sc.why)));

  const textCol = el("div", { class: "text-col" },
    linesGrid(sc),
    notesSection(sc),
    vocabSection(sc),
    el("div", { class: "scene-foot" },
      el("span", {}, `selected by ${sc.selected_by}`),
      sc.annotation.annotated ? el("span", {}, annotationSummary(sc)) : null,
      sc.media && sc.media.audio_lufs !== null ? el("span", {}, `${sc.media.audio_lufs} LUFS, peak ${sc.media.audio_peak_db} dBTP`) : null,
      sc.media ? el("span", {}, `clip ${fmtTime(sc.media.clip_start_ms, 1)} – ${fmtTime(sc.media.clip_end_ms, 1)} in the episode`) : null));

  main.classList.toggle("show-gl", state.glosses);
  main.classList.toggle("show-subs", state.showSubs);
  main.replaceChildren(head, el("div", { class: "scene-body" }, playerCol, textCol));
  main.scrollTop = 0;
  updatePlayButton();
  player.tick();
}

function annotationSummary(sc) {
  const a = sc.annotation;
  const lines = (n) => `${n} line${n === 1 ? "" : "s"}`;
  return (a.annotated === a.lines ? "annotated" : `${a.annotated} of ${lines(a.lines)} annotated`)
    + (a.aligned === a.annotated ? (a.aligned ? ", aligned" : "") : `, ${a.aligned ? a.aligned : "none"} of ${a.annotated} aligned`)
    + ` · ${a.units} units`;
}

// Hides the literal English, the subtitle English, and unit glosses and notes.
function setHideEnglish(on) {
  state.hideEnglish = on;
  store("hideEnglish", on);
  state.revealed.clear();
  const cb = $("#hide-en");
  if (cb) cb.checked = on;
  for (const c of document.querySelectorAll("[data-mask]")) {
    c.classList.toggle("masked", on && !c.classList.contains("none"));
  }
}

// ---------------------------------------------------------------------------
// review marks: lines, or units, marked as needing a fix (docs/review-ui.md, "Review marks")

// Open marks on the lines of a scene summary. Marks belong to lines, so overlapping
// scenes count the marks of the lines they share.
function openMarks(s) {
  return state.marks.filter((m) => m.episode_id === s.episode_id && m.line_idx >= s.first_line_idx && m.line_idx <= s.last_line_idx).length;
}

// Every mark of line l (open and resolved), from the open scene's payload.
function lineMarks(l) {
  const sc = state.scene;
  return sc && sc.marks ? sc.marks.filter((m) => m.line_id === l.id) : [];
}

async function loadMarks() {
  try { state.marks = await api("/api/marks?status=open"); }
  catch (e) { toast("Could not load the review marks: " + e.message); return; }
  if (!state.episode) { renderMarkList(); return; }
  for (const b of document.querySelectorAll(".tl-scene")) {
    const s = state.scenes.find((x) => x.id === b.dataset.id);
    b.classList.toggle("marked", !!(s && openMarks(s)));
  }
  renderList(); renderStats(); renderMarkList();
}

function markButton(l, i) {
  const n = lineMarks(l).filter((m) => m.status === "open").length;
  return el("button", {
    type: "button", class: "mark-btn" + (n ? " has" : ""),
    title: n ? `${n} open mark${n > 1 ? "s" : ""} on this line: click to add another` : "Mark this line as needing a fix (M)",
    onclick: (ev) => { ev.stopPropagation(); openMarkForm(i); },
  }, n ? `⚑${n}` : "⚑");
}

function markChip(m, i) {
  const open = m.status === "open";
  const sc = state.scene;
  return el("div", { class: `mark st-${m.status}`, id: "mark-" + m.id },
    el("div", { class: "mk-head" },
      el("span", { class: "mk-cat" }, open ? "⚑ " : m.status === "done" ? "✓ " : "✕ ", m.category),
      m.unit_idx !== null ? el("span", { class: "mk-unit", lang: "fr", title: `unit ${m.unit_idx}` }, m.unit_text) : el("span", { class: "mk-unit whole" }, "whole line"),
      m.scene_id !== sc.id ? el("span", { class: "mk-where" }, `marked in ${m.scene_id}`) : null,
      open ? el("span", { class: "mk-actions" },
        el("button", { type: "button", class: "link", onclick: () => openMarkForm(i, { id: m.id }) }, "edit"),
        el("button", { type: "button", class: "link danger", onclick: () => deleteMark(m) }, "delete")) : null),
    m.comment ? el("div", { class: "mk-comment" }, m.comment) : el("div", { class: "mk-comment none" }, "no comment"),
    open ? null : el("div", { class: "mk-res" }, `${m.status} ${m.resolved_at.slice(0, 10)}: ${m.resolution}`));
}

// The marks of a line and, while it is open there, the mark form; inside the French cell.
function lineMarksBlock(l, i) {
  const f = state.markForm;
  const formHere = f && f.line === i;
  const ms = lineMarks(l).filter((m) => !(formHere && f.id === m.id));
  if (!ms.length && !formHere) return null;
  return el("div", { class: "marks-box", lang: "en", onclick: (ev) => ev.stopPropagation() },
    ...ms.map((m) => markChip(m, i)),
    formHere ? markForm(l, i) : null);
}

function markForm(l, i) {
  const sc = state.scene;
  const f = state.markForm;
  const editing = f.id !== null ? sc.marks.find((m) => m.id === f.id) : null;
  let category = editing ? editing.category : state.markCategory;
  const unitSel = el("select", { class: "mf-unit", "aria-label": "What is marked" },
    el("option", { value: "" }, "the whole line"),
    ...l.units.map((u) => el("option", { value: String(u.idx) }, `unit ${u.idx}: ${u.text}`)));
  unitSel.value = f.unitIdx === null ? "" : String(f.unitIdx);
  const pick = (c) => {
    category = c;
    for (const b of cats.children) b.setAttribute("aria-checked", String(b.dataset.cat === c));
  };
  const cats = el("div", { class: "mf-cats", role: "radiogroup", "aria-label": "Category" },
    ...MARK_CATEGORIES.map(([c, help], k) => el("button", {
      type: "button", role: "radio", class: "mf-cat", dataset: { cat: c }, title: help,
      "aria-checked": String(c === category), onclick: () => { pick(c); comment.focus(); },
    }, el("kbd", {}, String(k + 1)), " ", c)));
  const comment = el("textarea", { class: "mf-comment", rows: 2, "aria-label": "Comment",
    placeholder: "What is wrong, and what it should be…" });
  comment.value = editing ? editing.comment : "";
  const status = el("span", { class: "mf-status" });

  async function save() {
    const body = { category, comment: comment.value, unit_idx: unitSel.value ? Number(unitSel.value) : null };
    status.textContent = "saving…";
    let m;
    try {
      m = editing
        ? await api(`/api/marks/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await api("/api/marks", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene_id: sc.id, line_id: l.id, ...body }) });
    } catch (e) {
      status.textContent = "not saved";
      toast(`Could not save the mark: ${e.message}`);
      return;
    }
    state.markCategory = category;
    store("markCategory", category);
    const k = sc.marks.findIndex((x) => x.id === m.id);
    if (k >= 0) sc.marks[k] = m; else sc.marks.push(m);
    if (state.scene === sc) { state.markForm = null; rerenderLines(); }
    await loadMarks();
    flash(document.getElementById("mark-" + m.id));
  }

  const form = el("form", { class: "mark-form" + (editing ? " editing" : "") },
    el("div", { class: "mf-row" },
      el("span", { class: "mf-title" }, editing ? `Edit mark ${editing.id}` : `Mark line ${l.idx}`),
      l.units.length ? unitSel : el("span", { class: "muted small" }, "the whole line")),
    cats, comment,
    el("div", { class: "mf-row" },
      el("button", { type: "submit", class: "mf-save" }, "Save ", el("kbd", {}, "Enter")),
      el("button", { type: "button", onclick: closeMarkForm }, "Cancel ", el("kbd", {}, "Esc")),
      status,
      el("span", { class: "mf-hint" }, "1–6 category · Shift+Enter new line")));
  form.addEventListener("submit", (ev) => { ev.preventDefault(); save(); });
  form.addEventListener("keydown", (ev) => {
    // The page's shortcuts stay out of the form; the form has its own.
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); closeMarkForm(); return; }
    const onCat = ev.target.classList.contains("mf-cat");
    if (ev.target === comment) {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); save(); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target === unitSel) return;
    if (/^[1-6]$/.test(ev.key)) { ev.preventDefault(); pick(MARK_CATEGORIES[Number(ev.key) - 1][0]); comment.focus(); return; }
    if (onCat && (ev.key === "ArrowRight" || ev.key === "ArrowLeft")) {
      ev.preventDefault();
      const k = MARK_CATEGORIES.findIndex(([c]) => c === category) + (ev.key === "ArrowRight" ? 1 : -1);
      const c = MARK_CATEGORIES[(k + MARK_CATEGORIES.length) % MARK_CATEGORIES.length][0];
      pick(c);
      cats.querySelector(`[data-cat="${c}"]`).focus();
      return;
    }
    // Typing on a category starts the comment.
    if (onCat && ev.key.length === 1 && ev.key !== " ") comment.focus();
    if (onCat && ev.key === "Enter") { ev.preventDefault(); comment.focus(); }
  });
  return form;
}

// Opens the mark form on line i: a new mark (on unit unitIdx, or the whole line), or
// mark `id` to edit.
function openMarkForm(i, { unitIdx = null, id = null } = {}) {
  const sc = state.scene;
  if (!sc || !sc.lines[i]) return;
  if (id !== null) {
    const m = sc.marks.find((x) => x.id === id);
    unitIdx = m ? m.unit_idx : null;
  }
  state.markForm = { line: i, id, unitIdx };
  rerenderLines();
  const form = document.querySelector(".mark-form");
  if (!form) return;
  form.scrollIntoView({ block: "nearest" });
  (id !== null ? form.querySelector(".mf-comment") : form.querySelector('.mf-cat[aria-checked="true"]')).focus();
}

function closeMarkForm() {
  state.markForm = null;
  rerenderLines();
}

async function deleteMark(m) {
  const sc = state.scene;
  if (!confirm(`Delete this ${m.category} mark on line ${m.line_idx}?`)) return;
  try { await api(`/api/marks/${m.id}`, { method: "DELETE" }); }
  catch (e) { toast(`Could not delete the mark: ${e.message}`); return; }
  sc.marks = sc.marks.filter((x) => x.id !== m.id);
  if (state.scene === sc) rerenderLines();
  await loadMarks();
}

// M: mark the selected unit, or else the line being played (or the first line).
function markKey() {
  const sc = state.scene;
  if (!sc || !sc.lines.length) return;
  const sel = state.selUnit;
  const u = sel && sc.lines[sel[0]] && sc.lines[sel[0]].units[sel[1]];
  if (u) return openMarkForm(sel[0], { unitIdx: u.idx });
  openMarkForm(Math.max(0, player.activeLine >= 0 ? player.activeLine : currentLineIndex()));
}

// Rebuilds the lines (after a mark changed) without touching the player.
function rerenderLines() {
  const old = $(".lines");
  if (!old || !state.scene) return;
  old.replaceWith(linesGrid(state.scene));
  player.activeLine = -1;
  player.activeUnit = "";
  player.tick();
}

// The sidebar shows the scene list or the open marks of every scene.
function setSide(side) {
  state.side = side;
  store("side", side);
  $("#sidebar").classList.toggle("show-marks", side === "marks");
  for (const b of document.querySelectorAll("[data-side]")) {
    b.classList.toggle("on", b.dataset.side === side);
    b.setAttribute("aria-selected", String(b.dataset.side === side));
  }
  renderMarkList();
}

function renderMarkList() {
  $("#marks-count").textContent = state.marks.length ? String(state.marks.length) : "";
  const ol = $("#mark-list");
  const list = state.marks.filter((m) => !state.marksEpisode || m.episode_id === state.marksEpisode);
  ol.replaceChildren(...list.map((m) => el("li", {},
    el("button", { type: "button", class: "mk-item" + (m.scene_id === state.sceneId ? " selected" : ""), dataset: { id: m.id },
      title: "Go to this line", onclick: () => jumpToMark(m) },
      el("span", { class: "mk-cat" }, m.category),
      el("span", { class: "mk-where" }, `${m.episode_id.toUpperCase()} · line ${m.line_idx}`),
      el("span", { class: "t" }, m.scene_title),
      el("span", { class: "sub", lang: "fr" }, m.unit_idx !== null ? `“${m.unit_text}” in ` : "", m.line_fr.replace(/\n/g, " / ")),
      el("span", { class: "mk-comment" }, m.comment || "no comment")))));
  if (!list.length) {
    ol.append(el("li", { class: "empty-list" }, state.marks.length ? "No open marks in this episode."
      : "No open marks. Press M on a line, or click ⚑ beside it, to mark it as needing a fix."));
  }
}

async function jumpToMark(m) {
  if (state.sceneId !== m.scene_id) await openScene(m.scene_id);
  flash(document.getElementById("mark-" + m.id));
}

// ---------------------------------------------------------------------------
// navigation

async function loadEpisode(id, sceneId = null) {
  const token = ++state.loadToken;
  const [ep, scenes] = await Promise.all([api(`/api/episodes/${id}`), api(`/api/episodes/${id}/scenes`)]);
  if (token !== state.loadToken) return;
  state.episode = ep;
  state.scenes = scenes;
  $("#episode").value = id;
  store("episode", id);
  fillTagFilter();
  renderStats();
  const target = sceneId && scenes.some((s) => s.id === sceneId) ? sceneId
    : (filteredScenes()[0] || scenes[0] || {}).id || null;
  state.sceneId = target;
  renderTimeline();
  renderList();
  if (target) await openScene(target, { replace: true });
  else { state.scene = null; renderScene(); }
}

async function openScene(id, { replace = false } = {}) {
  const episodeId = id.split("-")[0];
  if (!state.episode || state.episode.id !== episodeId) return loadEpisode(episodeId, id);
  const token = ++state.loadToken;
  state.sceneId = id;
  state.revealed.clear();
  state.subsOpen.clear();
  state.selUnit = null;
  state.markForm = null;
  updateTimelineSelection();
  renderMarkList();
  for (const li of document.querySelectorAll("#scene-list li")) li.classList.toggle("selected", li.dataset.id === id);
  const sel = document.querySelector("#scene-list li.selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
  const hash = "#" + id;
  if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash);
  let sc;
  try { sc = await api(`/api/scenes/${encodeURIComponent(id)}`); }
  catch (e) { if (token === state.loadToken) toast(`Could not load ${id}: ${e.message}`); return; }
  if (token !== state.loadToken) return;
  (sc.notes || []).forEach((x, k) => { x.n = k + 1; });
  state.scene = sc;
  // The list may be stale if the render step ran meanwhile.
  const summary = state.scenes.find((s) => s.id === id);
  if (summary && summary.rendered !== sc.rendered) {
    Object.assign(summary, { rendered: sc.rendered, clip_start_ms: sc.clip_start_ms, clip_end_ms: sc.clip_end_ms });
    renderList(); renderStats();
  }
  renderTimeline();
  renderScene();
}

function navigate(delta) {
  const all = orderedScenes();
  const visible = new Set(filteredScenes().map((s) => s.id));
  let i = all.findIndex((s) => s.id === state.sceneId);
  if (i < 0) i = delta > 0 ? -1 : all.length;
  for (let j = i + delta; j >= 0 && j < all.length; j += delta) {
    if (visible.has(all[j].id)) return openScene(all[j].id);
  }
}

// ---------------------------------------------------------------------------
// keyboard

function onKey(ev) {
  const t = ev.target;
  const typing = t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "checkbox") || t.tagName === "SELECT" || t.isContentEditable);
  if (ev.key === "Escape") {
    if (!$("#help").hidden) { $("#help").hidden = true; return; }
    if (typing) { t.blur(); ev.preventDefault(); }
    return;
  }
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key;
  const act = {
    " ": () => player.toggle(),
    "j": () => navigate(1), "ArrowDown": () => navigate(1),
    "k": () => navigate(-1), "ArrowUp": () => navigate(-1),
    "ArrowRight": () => playLine(currentLineIndex() + 1),
    "ArrowLeft": () => {
      // Like a music player: back to the start of the current line, or to the previous
      // line when already near its start.
      const sc = state.scene, i = currentLineIndex();
      if (!sc || !player.audio) return;
      const l = sc.lines[Math.max(0, i)];
      const into = player.audio.currentTime * 1000 - (lineSpan(l).a - lineLead(l));
      playLine(into > 1000 ? i : Math.max(0, i - 1));
    },
    "r": () => playLine(Math.max(0, currentLineIndex())),
    "0": () => player.seek(0), "Home": () => player.seek(0),
    "m": () => markKey(),
    "M": () => setSide(state.side === "marks" ? "scenes" : "marks"),
    "e": () => setHideEnglish(!state.hideEnglish),
    "s": () => toggleSlow(),
    "g": () => setGlosses(!state.glosses),
    "t": () => setShowSubs(!state.showSubs),
    ",": () => stepUnit(-1), ".": () => stepUnit(1),
    "/": () => $("#f-q").focus(),
    "?": () => { $("#help").hidden = !$("#help").hidden; },
  }[k];
  if (act) { ev.preventDefault(); act(); }
}

// ---------------------------------------------------------------------------
// start

async function init() {
  bindFilters();
  syncFilterInputs();
  document.addEventListener("keydown", onKey);
  $("#help-btn").addEventListener("click", () => { $("#help").hidden = false; });
  $("#help-close").addEventListener("click", () => { $("#help").hidden = true; });
  $("#help").addEventListener("click", (e) => { if (e.target.id === "help") e.currentTarget.hidden = true; });
  $("#episode").addEventListener("change", (e) => loadEpisode(e.target.value));
  window.addEventListener("popstate", () => { const id = location.hash.slice(1); if (id && id !== state.sceneId) openScene(id, { replace: true }); });
  for (const b of document.querySelectorAll("[data-side]")) b.addEventListener("click", () => setSide(b.dataset.side));
  $("#mk-episode").addEventListener("change", (e) => { state.marksEpisode = e.target.value; store("marksEpisode", state.marksEpisode); renderMarkList(); });
  setSide(state.side);
  // Chromium pauses video-only players in hidden tabs while the audio keeps going.
  document.addEventListener("visibilitychange", () => {
    const a = player.audio, v = player.video;
    if (document.visibilityState !== "visible" || !a || !v) return;
    v.currentTime = a.currentTime;
    if (!a.paused) { v.play().catch(() => {}); player.loop(); }
  });

  try { state.episodes = await api("/api/episodes"); }
  catch (e) { $("#scene").replaceChildren(el("div", { class: "empty" }, "Cannot reach the server: " + e.message)); return; }
  if (!state.episodes.length) { $("#scene").replaceChildren(el("div", { class: "empty" }, "The database has no episodes.")); return; }
  $("#episode").replaceChildren(...state.episodes.map((e) =>
    el("option", { value: e.id }, `${e.id.toUpperCase()} · ${e.scenes} scenes`)));
  $("#mk-episode").append(...state.episodes.map((e) => el("option", { value: e.id }, e.id.toUpperCase())));
  $("#mk-episode").value = state.episodes.some((e) => e.id === state.marksEpisode) ? state.marksEpisode : "";
  await loadMarks();

  const hash = decodeURIComponent(location.hash.slice(1));
  const ids = state.episodes.map((e) => e.id);
  let ep = hash.split("-")[0];
  if (!ids.includes(ep)) ep = ids.includes(store("episode")) ? store("episode") : ids[0];
  await loadEpisode(ep, hash.includes("-") ? hash : null);
}

init();
