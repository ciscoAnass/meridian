/* App: state, navigation, keyboard, search, reminders, calendars, import/export. */
"use strict";
(function (M) {
  const { D, F, $, $$, esc, h } = M;
  const VIEWS = ["day", "week", "month", "agenda"];

  M.settings = {
    week_start: "auto", time_format: "auto", day_start_hour: 8, default_duration: 60,
    default_alert: 10, show_week_numbers: false, sidebar: true, view: "month",
  };
  M.state = { view: "month", date: D.today(), miniMonth: D.today(), selected: null, lastCalendar: null, agendaDays: 60, search: "" };

  const app = {};
  M.app = app;

  // ================================================================ toasts
  M.toast = function (text, action) {
    const box = $("#toasts");
    while (box.children.length > 2) box.firstElementChild.remove();
    const t = h(`<div class="toast"><span>${esc(text)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}</div>`);
    const bye = () => { if (!t.isConnected) return; t.classList.add("bye"); setTimeout(() => t.remove(), 200); };
    if (action) t.querySelector("button").addEventListener("click", () => { bye(); action.run(); });
    box.appendChild(t);
    setTimeout(bye, action ? 6000 : 3200);
  };

  // ============================================================ rendering
  app.renderAll = function (anim) {
    M.V.render(anim);
    M.V.renderSidebar();
    if (M.state.search) renderSearch();
  };

  M.store.onChange((reason) => {
    if (reason === "editor") {
      // Keep the open editor stable; repaint the calendar underneath it.
      M.V.render();
      M.V.renderSidebar();
      const target = M.editor.key && document.querySelector(`[data-key="${M.editor.key}"]`);
      if (target) M.editor.anchor = target;
      if (M.state.search) renderSearch();
      return;
    }
    app.renderAll();
    if (M.editor.isOpen()) M.editor.refresh();
  });

  // =========================================================== navigation
  app.setView = function (view) {
    if (!VIEWS.includes(view) || view === M.state.view) { M.bridge.call("state", { view: M.state.view }); return; }
    M.editor.close({ silent: true });
    M.state.view = view;
    app.renderAll("fade");
  };

  app.step = function (dir) {
    M.editor.close({ silent: true });
    const s = M.state;
    if (s.view === "month") s.date = D.addMonths(D.startOfMonth(s.date), dir);
    else if (s.view === "week") s.date = D.addDays(s.date, dir * 7);
    else if (s.view === "day") s.date = D.addDays(s.date, dir);
    else s.date = D.addDays(s.date, dir * 30);
    s.miniMonth = D.startOfMonth(s.date);
    app.renderAll(dir > 0 ? "next" : "prev");
  };

  app.today = function () {
    M.editor.close({ silent: true });
    const t = D.today();
    const inView = visibleRange();
    const already = t >= inView[0] && t < inView[1] && D.sameDay(M.state.date, t);
    M.state.date = t;
    M.state.miniMonth = D.startOfMonth(t);
    app.renderAll(already ? null : "fade");
    const sc = $(".tg-scroll");
    if (sc) sc.scrollTo({ top: Math.max(0, (D.minutesOfDay(new Date()) / 60 - 2) * hourPx()), behavior: M.reducedMotion() ? "auto" : "smooth" });
  };

  app.selectDate = function (date) {
    const [a, b] = visibleRange();
    const outside = date < a || date >= b;
    const dir = date < a ? "prev" : "next";
    M.state.date = D.startOfDay(date);
    M.state.miniMonth = D.startOfMonth(date);
    app.renderAll(outside ? dir : null);
  };

  /** Make sure `date` is on screen without jarring the user if it already is. */
  app.ensureVisible = function (date) {
    const [a, b] = visibleRange();
    if (date >= a && date < b) return;
    M.state.date = D.startOfDay(date);
    M.state.miniMonth = D.startOfMonth(date);
    app.renderAll();
  };

  function visibleRange() {
    const { view, date } = M.state;
    if (view === "month") { const g = M.V.monthGeometry(date); return [D.startOfMonth(date), D.startOfMonth(D.addMonths(D.startOfMonth(date), 1)), g]; }
    if (view === "week") { const s = D.startOfWeek(date, M.weekStart()); return [s, D.addDays(s, 7)]; }
    if (view === "day") { const s = D.startOfDay(date); return [s, D.addDays(s, 1)]; }
    const s = D.startOfDay(date); return [s, D.addDays(s, M.state.agendaDays)];
  }

  const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;

  app.setSidebar = function (visible, tell = true) {
    M.settings.sidebar = visible;
    $("#app").classList.toggle("no-sidebar", !visible);
    if (tell) M.bridge.call("state", { sidebar: visible });
    setTimeout(() => { M.V.refitMonth(); M.editor.reposition(); }, 340);
  };

  app.focusView = function () {
    const v = $("#view");
    v.setAttribute("tabindex", "-1");
    v.focus({ preventScroll: true });
  };

  // ============================================================== events
  function select(key) {
    M.state.selected = key;
    $$(".sel[data-key]").forEach((n) => n.classList.remove("sel"));
    if (key) $$(`[data-key="${key}"]`).forEach((n) => { if (n.matches(".ev, .bar, .mchip, .ag-item")) n.classList.add("sel"); });
  }

  app.openOcc = function (key, anchor, opts) {
    select(key);
    M.editor.open(key, anchor, opts);
  };

  app.onEditorClosed = function () {
    // Keep the selection so Delete still works, but repaint to settle layout.
    if (M.state.selected && !M.store.findOcc(M.state.selected)) M.state.selected = null;
  };

  app.createAt = function (start, end, allDay) {
    const calId = M.state.lastCalendar && M.store.data.calendars.some((c) => c.id === M.state.lastCalendar && c.visible)
      ? M.state.lastCalendar
      : (M.store.data.calendars.find((c) => c.visible) || M.store.data.calendars[0]).id;
    if (!M.store.calendar(calId).visible) M.store.toggleCalendar(calId);
    const ev = M.store.newEvent({
      calendarId: calId, allDay,
      start: allDay ? D.ymd(start) : D.iso(start),
      end: allDay ? D.ymd(end) : D.iso(end),
      alerts: allDay ? [] : (M.settings.default_alert >= 0 ? [M.settings.default_alert] : []),
    });
    M.store.addEvent(ev);
    const key = `${ev.id}@${D.ymd(start)}`;
    app.ensureVisible(start);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) {
        const sc = el.closest(".tg-scroll");
        if (sc) {
          const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
          if (r.top < sr.top || r.bottom > sr.bottom) sc.scrollTop += r.top - sr.top - 60;
        }
      }
      app.openOcc(key, el, { isNew: true });
    });
  };

  /** "N" / the + button: a new event at the next sensible slot on the focused day. */
  app.newEvent = function () {
    const now = new Date();
    const day = M.state.date;
    let start;
    if (D.sameDay(day, now)) {
      start = D.addMinutes(D.startOfDay(now), Math.ceil((D.minutesOfDay(now) + 1) / 30) * 30);
      if (!D.sameDay(start, now)) start = D.addMinutes(D.startOfDay(now), 23 * 60);
    } else {
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    }
    app.createAt(start, D.addMinutes(start, M.settings.default_duration || 60), false);
  };

  app.applyMove = async function (occ, start, end) {
    let scope = "single";
    if (occ.recurring) {
      scope = await M.askScope("change");
      if (!scope) { M.V.render(); return; }
    }
    const id = M.store.moveOcc(occ, start, end, scope);
    select(`${id}@${D.ymd(start)}`);
    M.V.render();
  };

  app.deleteOcc = async function (occ) {
    if (!occ) return;
    let scope = "all";
    if (occ.recurring) {
      scope = await M.askScope("delete");
      if (!scope) return;
    }
    M.editor.close({ silent: true });
    M.store.deleteOcc(occ, scope);
    M.state.selected = null;
    const title = occ.ev.title ? `“${occ.ev.title}” deleted` : "Event deleted";
    M.toast(title, { label: "Undo", run: () => M.store.undo() });
    app.focusView();
  };

  /** Jump to an occurrence, highlight it and optionally open it. */
  app.reveal = function (key, { open = true } = {}) {
    const occ = M.store.findOcc(key);
    if (!occ) { M.toast("That event no longer exists."); return; }
    const cal = M.store.calendar(occ.ev.calendarId);
    if (!cal.visible) M.store.toggleCalendar(cal.id);
    app.ensureVisible(occ.start);
    select(key);
    requestAnimationFrame(() => {
      const el = document.querySelector(`.ev[data-key="${key}"], .bar[data-key="${key}"], .mchip[data-key="${key}"], .ag-item[data-key="${key}"]`);
      if (!el) return;
      const sc = el.closest(".tg-scroll, .agenda");
      if (sc) {
        const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
        if (r.top < sr.top + 20 || r.bottom > sr.bottom - 20) sc.scrollTop += r.top - sr.top - sr.height / 3;
      }
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
      if (open) setTimeout(() => app.openOcc(key, el), M.reducedMotion() ? 0 : 60);
    });
  };

  // =========================================================== calendars
  async function editCalendar(cal) {
    const res = await M.dialog({
      title: cal ? "Edit calendar" : "New calendar",
      input: { value: cal ? cal.name : "", placeholder: "Calendar name" },
      swatches: { value: cal ? cal.color : M.PALETTE[(M.store.data.calendars.length * 3 + 5) % M.PALETTE.length].hex },
      actions: [{ label: cal ? "Save" : "Create calendar", value: "ok", kind: "primary" }, { label: "Cancel", value: null, kind: "plain" }],
    });
    if (!res || res.action !== "ok") return;
    const name = res.text || (cal ? cal.name : "Untitled");
    if (cal) M.store.updateCalendar(cal.id, { name, color: res.color });
    else { const c = M.store.addCalendar(name, res.color); M.state.lastCalendar = c.id; }
  }

  async function deleteCalendar(cal) {
    if (M.store.data.calendars.length <= 1) { M.toast("Keep at least one calendar."); return; }
    const n = M.store.data.events.filter((e) => e.calendarId === cal.id).length;
    const ok = await M.dialog({
      title: `Delete “${cal.name}”?`,
      text: n ? `This removes the calendar and its ${n} event${n > 1 ? "s" : ""}.` : "This calendar has no events.",
      actions: [{ label: "Delete calendar", value: true, kind: "danger" }, { label: "Cancel", value: null, kind: "plain" }],
    });
    if (!ok) return;
    M.store.deleteCalendar(cal.id);
    M.toast(`“${cal.name}” deleted`, { label: "Undo", run: () => M.store.undo() });
  }

  function calendarMenu(anchor, cal) {
    M.menu(anchor, [
      { label: "Edit…", value: "edit" },
      { label: "Show only this calendar", value: "solo" },
      { label: "Show all calendars", value: "all" },
      { sep: true },
      { label: "Delete calendar…", value: "delete", danger: true },
    ], (v) => {
      if (v === "edit") editCalendar(cal);
      else if (v === "delete") deleteCalendar(cal);
      else M.store.touch((d) => d.calendars.forEach((c) => { c.visible = v === "all" || c.id === cal.id; }), "visibility");
    }, { checks: false });
  }

  // ============================================================== search
  function highlight(text, q) {
    const n = M.norm(text), i = n.indexOf(q);
    if (i < 0 || !q) return esc(text);
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  }

  function renderSearch() {
    const panel = $("#search-panel");
    const q = M.norm(M.state.search.trim());
    if (!q) { panel.hidden = true; M.V.refitMonth(); return; }
    const wasHidden = panel.hidden;
    const now = new Date();
    const hits = [];
    for (const ev of M.store.data.events) {
      if (![ev.title, ev.location, ev.notes].some((f) => M.norm(f).includes(q))) continue;
      const occ = M.R.nextOccurrence(ev, D.today());
      if (occ) hits.push(occ);
    }
    const upcoming = hits.filter((o) => o.end >= now).sort((a, b) => a.start - b.start);
    const past = hits.filter((o) => o.end < now).sort((a, b) => b.start - a.start);
    const item = (o) => `<button class="sp-item" type="button" data-key="${o.key}" style="--c:${M.store.calendar(o.ev.calendarId).color}"><i></i>
      <span><b>${highlight(o.ev.title || "New event", q)}</b><small>${esc(F.relativeDay(o.start))}${o.ev.allDay ? "" : `, ${esc(F.time(o.start))}`}${o.ev.location ? ` · ${esc(o.ev.location)}` : ""}</small></span></button>`;
    const total = hits.length;
    panel.innerHTML = `<div class="sp-head"><h2>Results</h2><small>${total || "No"} match${total === 1 ? "" : "es"}</small></div>
      <div class="sp-list">${total ? (upcoming.length ? `<div class="sp-group">Upcoming</div>${upcoming.slice(0, 60).map(item).join("")}` : "")
        + (past.length ? `<div class="sp-group">Past</div>${past.slice(0, 60).map(item).join("")}` : "")
        : `<p class="sp-none">No events match “${esc(M.state.search.trim())}”.<br>Search looks at titles, locations and notes.</p>`}</div>`;
    panel.hidden = false;
    if (wasHidden) M.V.refitMonth();
  }

  function closeSearch() {
    M.state.search = "";
    renderSearch();
    M.bridge.call("clear_search");
    app.focusView();
  }

  // ============================================================ reminders
  let lastCheck = null;
  function checkReminders() {
    const now = new Date();
    if (!lastCheck) {
      const stored = M.store.data.meta.lastReminderCheck ? new Date(M.store.data.meta.lastReminderCheck) : null;
      // Deliver reminders missed in the last 15 minutes; older ones are stale.
      lastCheck = new Date(Math.max(stored ? stored.getTime() : 0, now.getTime() - 15 * D.MIN));
    }
    const from = D.addDays(lastCheck, -8);
    const to = D.addDays(now, 8);
    let fired = 0;
    for (const o of M.store.range(from, to, { includeHidden: true })) {
      for (const a of o.ev.alerts || []) {
        const at = o.start.getTime() - a * D.MIN;
        if (at > lastCheck.getTime() && at <= now.getTime()) {
          fired++;
          let when;
          if (o.ev.allDay) when = D.sameDay(o.start, now) ? "Today" : F.relativeDay(o.start);
          else if (a === 0 || o.start <= now) when = `Now, ${F.range(o.start, o.end)}`;
          else if (D.sameDay(o.start, now)) when = `In ${F.duration(Math.round((o.start - now) / D.MIN))}, ${F.range(o.start, o.end)}`;
          else when = `${F.relativeDay(o.start)}, ${F.range(o.start, o.end)}`;
          const body = o.ev.location ? `${when}\n${o.ev.location}` : when;
          M.bridge.call("notify", { key: o.key, title: o.ev.title || "New event", body });
        }
      }
    }
    lastCheck = now;
    M.store.data.meta.lastReminderCheck = now.toISOString();
    if (fired) M.store.scheduleSave();
  }

  // ========================================================== import/export
  async function importICS({ name, text }) {
    let parsed;
    try { parsed = M.ICS.parse(text); } catch (e) { M.toast("That file isn’t a readable calendar."); return; }
    if (!parsed.events.length) { M.toast("No events found in that file."); return; }
    const calName = parsed.name || name || "Imported";
    const n = parsed.events.length;
    const ok = await M.dialog({
      title: `Import ${n} event${n > 1 ? "s" : ""}?`,
      text: `They’ll be added to a new calendar called “${calName}”.${parsed.skipped ? ` ${parsed.skipped} cancelled or unreadable item${parsed.skipped > 1 ? "s were" : " was"} skipped.` : ""}`,
      actions: [{ label: "Import", value: true, kind: "primary" }, { label: "Cancel", value: null, kind: "plain" }],
    });
    if (!ok) return;
    const used = new Set(M.store.data.calendars.map((c) => c.color));
    const color = (M.PALETTE.find((p) => !used.has(p.hex)) || M.PALETTE[6]).hex;
    M.store.commit((d) => {
      const cal = { id: M.uid(), name: calName, color, visible: true };
      d.calendars.push(cal);
      const now = new Date().toISOString();
      for (const e of parsed.events) d.events.push({ id: M.uid(), calendarId: cal.id, created: now, updated: now, ...e });
    }, "import");
    const first = parsed.events.map((e) => D.parse(e.start)).filter((d) => d >= D.today()).sort((a, b) => a - b)[0];
    if (first) app.ensureVisible(first);
    M.toast(`Imported ${n} event${n > 1 ? "s" : ""}`, { label: "Undo", run: () => M.store.undo() });
  }

  async function exportICS() {
    const n = M.store.data.events.length;
    if (!n) { M.toast("There are no events to export yet."); return; }
    const res = await M.bridge.call("export", { text: M.ICS.exportAll(M.store.data), filename: `Meridian ${D.ymd(new Date())}.ics` });
    if (res && res.ok) M.toast(`Exported ${n} event${n > 1 ? "s" : ""}`);
    else if (res && res.error) M.toast(`Export failed: ${res.error}`);
  }

  // ============================================================ keyboard
  function onKey(e) {
    const t = e.target;
    const typing = t.matches && t.matches("input, textarea, [contenteditable]");
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === "z" && !typing) { e.preventDefault(); (e.shiftKey ? M.store.redo() : M.store.undo()); return; }
      if (lk === "y" && !typing) { e.preventDefault(); M.store.redo(); return; }
      if (lk === "f") { e.preventDefault(); M.bridge.call("focus_search"); return; }
      if (lk === "b") { e.preventDefault(); app.setSidebar(!M.settings.sidebar); return; }
      if (lk === "n") { e.preventDefault(); app.newEvent(); return; }
      if (lk === "q") { e.preventDefault(); M.bridge.call("action", { name: "quit" }); return; }
      if (k === "?" || (lk === "/" && e.shiftKey)) { e.preventDefault(); M.bridge.call("action", { name: "shortcuts" }); return; }
      if (k === ",") { e.preventDefault(); M.bridge.call("action", { name: "preferences" }); return; }
      return;
    }
    if (typing || e.altKey) return;
    if ($(".dialog-back") || M.menuOpen()) return;

    // Search result navigation.
    if (t.classList && t.classList.contains("sp-item")) {
      const items = $$(".sp-item");
      const i = items.indexOf(t);
      if (k === "ArrowDown") { e.preventDefault(); (items[i + 1] || t).focus(); return; }
      if (k === "ArrowUp") { e.preventDefault(); i > 0 ? items[i - 1].focus() : M.bridge.call("focus_search"); return; }
      if (k === "Escape") { e.preventDefault(); closeSearch(); return; }
    }

    if (k === "Escape") {
      if (M.I.active()) { M.I.cancel(); M.V.render(); return; }
      if (M.editor.isOpen()) { M.editor.close(); app.focusView(); return; }
      if (M.state.search) { closeSearch(); return; }
      if (M.state.selected) { select(null); return; }
      return;
    }
    if (M.editor.isOpen() && (k === "Delete" || k === "Backspace")) {
      e.preventDefault();
      app.deleteOcc(M.store.findOcc(M.editor.key));
      return;
    }
    if ((k === "Enter" || k === " ") && t.dataset && t.dataset.key && t.matches(".ev, .bar, .mchip")) {
      e.preventDefault(); app.openOcc(t.dataset.key, t); return;
    }
    switch (k) {
      case "t": case "T": app.today(); break;
      case "d": case "1": app.setView("day"); break;
      case "w": case "2": app.setView("week"); break;
      case "m": case "3": app.setView("month"); break;
      case "a": case "4": app.setView("agenda"); break;
      case "ArrowLeft": case "j": case "J": app.step(-1); break;
      case "ArrowRight": case "k": case "K": app.step(1); break;
      case "n": case "N": app.newEvent(); break;
      case "/": M.bridge.call("focus_search"); break;
      case "?": M.bridge.call("action", { name: "shortcuts" }); break;
      case "Delete": case "Backspace":
        if (M.state.selected) app.deleteOcc(M.store.findOcc(M.state.selected));
        break;
      default: return;
    }
    e.preventDefault();
  }

  // ============================================================== clicks
  function onClick(e) {
    const t = e.target;
    if (t.closest(".ev, .bar, .mchip")) return; // handled by interact.js
    const act = t.closest("[data-action]");
    if (act) {
      if (act.dataset.action === "new") app.newEvent();
      if (act.dataset.action === "agenda-more") { M.state.agendaDays += 60; M.V.render(); }
      return;
    }
    const keyed = t.closest(".ag-item, .da-item, .up-item, .sp-item");
    if (keyed) {
      if (keyed.matches(".up-item, .sp-item")) app.reveal(keyed.dataset.key);
      else app.openOcc(keyed.dataset.key, keyed);
      return;
    }
    const more = t.closest("[data-more]");
    if (more) { M.state.date = D.parse(more.dataset.more); M.state.view = "day"; app.renderAll("fade"); return; }
    const goto = t.closest("[data-goto]");
    if (goto) { M.state.date = D.parse(goto.dataset.goto); M.state.view = "day"; app.renderAll("fade"); return; }
    const mini = t.closest("#mini [data-mini]");
    if (mini) { M.state.miniMonth = D.addMonths(M.state.miniMonth, Number(mini.dataset.mini)); M.V.renderSidebar(); return; }
    const miniDay = t.closest("#mini .mini-day");
    if (miniDay) { M.editor.close({ silent: true }); app.selectDate(D.parse(miniDay.dataset.date)); return; }
    const toggle = t.closest("[data-toggle]");
    if (toggle) { M.store.toggleCalendar(toggle.dataset.toggle); return; }
    const cm = t.closest("[data-calmenu]");
    if (cm) { calendarMenu(cm, M.store.calendar(cm.dataset.calmenu)); return; }
    if (t.closest("#add-cal")) { editCalendar(null); return; }
    const cell = t.closest(".mcell");
    if (cell) {
      const d = D.parse(cell.dataset.date);
      select(null);
      if (!D.sameDay(d, M.state.date)) {
        M.state.date = d;
        $$(".mcell.sel").forEach((c) => c.classList.remove("sel"));
        cell.classList.add("sel");
        M.V.renderSidebar();
      }
      return;
    }
    if (t.closest(".tg-col, .tg-adlane")) select(null);
  }

  // ================================================================ boot
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function applySettings(s) {
    Object.assign(M.settings, s || {});
    F.detect();
    const H = innerHeight < 700 ? 46 : 52;
    document.documentElement.style.setProperty("--hour", `${H}px`);
  }

  function wireBridge() {
    const b = M.bridge;
    b.on("nav", ({ dir }) => app.step(dir));
    b.on("today", () => app.today());
    b.on("view", ({ view }) => app.setView(view));
    b.on("new", () => app.newEvent());
    b.on("sidebar", ({ visible }) => app.setSidebar(visible));
    b.on("theme", ({ dark }) => applyTheme(dark));
    b.on("settings", (s) => { applySettings(s); app.renderAll(); });
    b.on("search", ({ q }) => { M.state.search = q; renderSearch(); });
    b.on("search-activate", () => { const f = $(".sp-item"); if (f) app.reveal(f.dataset.key); });
    b.on("focus-results", () => { const f = $(".sp-item"); f ? f.focus() : app.focusView(); });
    b.on("show-event", ({ key }) => app.reveal(key));
    b.on("import", importICS);
    b.on("request-export", exportICS);
    b.on("toast", ({ text }) => M.toast(text));
  }

  async function boot() {
    wireBridge();
    let res = {};
    try { res = (await M.bridge.call("load")) || {}; } catch (e) { console.error(e); }
    applyTheme(!!res.dark);
    applySettings(res.settings);
    M.store.init(res.data);
    M.state.view = VIEWS.includes(M.settings.view) ? M.settings.view : "month";
    M.state.lastCalendar = M.store.data.calendars[0].id;
    $("#app").classList.toggle("no-sidebar", !M.settings.sidebar);
    if (innerWidth < 720) $("#app").classList.add("no-sidebar");

    M.I.init();
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    document.addEventListener("contextmenu", (e) => {
      if (!e.target.closest("input, textarea")) e.preventDefault();
    });
    window.addEventListener("resize", M.debounce(() => {
      applySettings({});
      if (M.state.view === "month") M.V.refitMonth(); else M.V.render();
      M.editor.reposition();
    }, 60));

    try { await document.fonts.ready; } catch (_) { /* no-op */ }
    app.renderAll();
    M.bridge.call("state", { view: M.state.view, sidebar: !$("#app").classList.contains("no-sidebar") });
    requestAnimationFrame(() => document.body.classList.remove("booting"));
    M.bridge.call("ready");

    // Clock: minute-aligned "now" updates, reminders every 15 s.
    checkReminders();
    setInterval(checkReminders, 15000);
    const tick = () => {
      M.V.updateNow();
      M.V.renderSidebar();
      setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    };
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    // Day rollover while running (e.g. left open overnight).
    let day = D.ymd(new Date());
    setInterval(() => { const n = D.ymd(new Date()); if (n !== day) { day = n; app.renderAll(); } }, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.M);
