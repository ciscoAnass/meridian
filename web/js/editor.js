/* Event editor (anchored popover that saves as you type), menus, pickers, dialogs. */
"use strict";
(function (M) {
  const { D, F, $, $$, esc, h } = M;
  const layer = () => $("#layer");

  // =============================================================== menus
  let openMenu = null;
  M.menu = function (anchor, items, onPick, opts = {}) {
    closeMenu();
    const el = h(`<div class="menu" role="menu"></div>`);
    items.forEach((it, i) => {
      if (it.sep) { el.appendChild(h(`<div class="menu-sep" role="separator"></div>`)); return; }
      const b = h(`<button class="menu-item${it.on ? " on" : ""}${it.danger ? " danger" : ""}" type="button" role="menuitemradio" aria-checked="${!!it.on}" data-i="${i}">
        ${it.sw ? `<span class="sw" style="--c:${it.sw}"></span>` : ""}<span>${esc(it.label)}</span><span class="chk">${opts.checks === false ? "" : M.icon.check}</span></button>`);
      b.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); onPick(it.value, it); });
      el.appendChild(b);
    });
    layer().appendChild(el);
    placeBelow(el, anchor);
    const btns = $$(".menu-item", el);
    const on = btns.find((b) => b.classList.contains("on")) || btns[0];
    if (on) {
      el.scrollTop = Math.max(0, on.offsetTop - el.clientHeight / 2 + on.offsetHeight / 2);
      if (opts.focus !== false) on.focus({ preventScroll: true });
    }
    // Clicking an item must not steal focus from the field that opened the menu.
    el.addEventListener("pointerdown", (e) => e.preventDefault());
    el.addEventListener("keydown", (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); quietFocus(anchor); }
    });
    openMenu = { el, anchor, custom: opts.custom };
    return el;
  };
  function closeMenu() { if (openMenu) { openMenu.el.remove(); openMenu = null; } }

  // Focus an element without it reacting as if the user had just focused it
  // (for example, a time field re-opening its list).
  let quiet = false;
  function quietFocus(el) {
    if (!el || !el.focus) return;
    quiet = true;
    try { el.focus({ preventScroll: true }); } finally { quiet = false; }
  }
  M.closeMenu = closeMenu;
  M.menuOpen = () => !!openMenu;

  function placeBelow(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    let x = r.left, y = r.bottom + 6;
    if (x + w > innerWidth - 10) x = innerWidth - w - 10;
    if (y + hgt > innerHeight - 10) y = Math.max(10, r.top - hgt - 6);
    el.style.left = `${Math.max(10, x)}px`;
    el.style.top = `${y}px`;
    el.style.transformOrigin = y < r.top ? "bottom left" : "top left";
  }

  document.addEventListener("pointerdown", (e) => {
    if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu();
  }, true);

  // ============================================================= dialogs
  M.dialog = function ({ title, text = "", actions, input, swatches }) {
    return new Promise((resolve) => {
      const back = h(`<div class="dialog-back"><div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}
        ${input ? `<input class="text" type="text" maxlength="60" value="${esc(input.value || "")}" placeholder="${esc(input.placeholder || "")}" aria-label="${esc(input.placeholder || title)}">` : ""}
        ${swatches ? `<div class="swatches" role="radiogroup" aria-label="Colour">${M.PALETTE.map((p) => `<button type="button" style="--c:${p.hex}" data-hex="${p.hex}" aria-label="${p.name}" aria-pressed="${p.hex === swatches.value}"></button>`).join("")}</div>` : ""}
        <div class="actions">${actions.map((a, i) => `<button class="btn ${a.kind || ""}" type="button" data-i="${i}">${esc(a.label)}</button>`).join("")}</div></div></div>`);
      document.body.appendChild(back);
      const field = $("input.text", back);
      let color = swatches && swatches.value;
      $$(".swatches button", back).forEach((b) => b.addEventListener("click", () => {
        color = b.dataset.hex;
        $$(".swatches button", back).forEach((x) => x.setAttribute("aria-pressed", x === b));
      }));
      const done = (v) => {
        back.remove();
        document.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      const value = (a) => (input || swatches ? (a.value == null ? null : { action: a.value, text: field ? field.value.trim() : "", color }) : a.value);
      $$(".actions .btn", back).forEach((b) => b.addEventListener("click", () => done(value(actions[b.dataset.i]))));
      back.addEventListener("pointerdown", (e) => { if (e.target === back) done(null); });
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === "Enter" && (field ? document.activeElement === field : true)) {
          e.preventDefault(); e.stopPropagation();
          const primary = actions.find((a) => a.kind && a.kind.includes("primary")) || actions[0];
          done(value(primary));
        }
      };
      document.addEventListener("keydown", onKey, true);
      (field || $(".actions .btn", back)).focus();
      if (field) field.select();
    });
  };

  M.askScope = function (verb) {
    const deleting = verb === "delete";
    return M.dialog({
      title: deleting ? "Delete a repeating event" : "Change a repeating event",
      text: deleting ? "Delete only this occurrence, or this and every one after it?" : "Apply this change to only this occurrence, or to this and every one after it?",
      actions: [
        { label: deleting ? "Delete only this event" : "Only this event", value: "this", kind: deleting ? "danger" : "primary" },
        { label: deleting ? "Delete all future events" : "All future events", value: "future", kind: deleting ? "danger" : "" },
        { label: "Cancel", value: null, kind: "plain" },
      ],
    });
  };

  // ============================================================== pickers
  function datePicker(anchor, value, onPick) {
    closeMenu();
    let month = D.startOfMonth(value);
    const el = h(`<div class="menu dp" role="dialog" aria-label="Choose date"></div>`);
    const paint = () => {
      el.innerHTML = M.V.miniGrid(month, { selected: value });
      $$(".mini-day", el).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); onPick(D.parse(b.dataset.date)); anchor.focus(); }));
      $$("[data-mini]", el).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); month = D.addMonths(month, Number(b.dataset.mini)); paint(); }));
    };
    paint();
    layer().appendChild(el);
    placeBelow(el, anchor);
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); } });
    openMenu = { el, anchor };
    const sel = $(".mini-day.sel", el);
    sel && sel.focus();
  }

  /** "9", "0930", "9:30", "9.30", "9pm", "9:30 PM", "21", "2115" -> minutes, or null. */
  function parseTime(text) {
    const t = String(text).trim().toLowerCase().replace(/\s+/g, "");
    const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/);
    if (!m) return null;
    let hh = Number(m[1]); const mm = Number(m[2] || 0); const ap = m[3];
    if (mm > 59) return null;
    if (ap) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (ap[0] === "p" ? 12 : 0); }
    if (hh > 23) return null;
    return hh * 60 + mm;
  }
  M.parseTime = parseTime;

  function timeList(input, value, onPick) {
    const items = [];
    for (let m = 0; m < 1440; m += 15) {
      const d = D.addMinutes(D.startOfDay(value), m);
      items.push({ label: F.time(d), value: m, on: m === D.snap(D.minutesOfDay(value)) });
    }
    const el = M.menu(input, items, (m) => onPick(m), { checks: false, focus: false });
    el.classList.add("tl");
    openMenu.anchor = input;
  }

  // =============================================================== editor
  const REPEAT = [
    { label: "Never", value: "none" },
    { label: "Every day", value: "daily" },
    { label: "Every weekday", value: "weekdays" },
    { label: "Every week", value: "weekly" },
    { label: "Every 2 weeks", value: "biweekly" },
    { label: "Every month", value: "monthly" },
    { label: "Every year", value: "yearly" },
    { sep: true },
    { label: "Custom…", value: "custom" },
  ];
  const ALERTS = [
    { label: "None", value: -1 }, { label: "At time of event", value: 0 },
    { label: "5 minutes before", value: 5 }, { label: "10 minutes before", value: 10 },
    { label: "15 minutes before", value: 15 }, { label: "30 minutes before", value: 30 },
    { label: "1 hour before", value: 60 }, { label: "2 hours before", value: 120 },
    { label: "1 day before", value: 1440 }, { label: "2 days before", value: 2880 },
  ];
  const ALL_DAY_ALERTS = [
    { label: "None", value: -1 }, { label: "On the day (09:00)", value: -540 },
    { label: "1 day before (09:00)", value: 900 }, { label: "2 days before (09:00)", value: 2340 },
    { label: "1 week before", value: 10080 },
  ];

  function repeatKey(r) {
    if (!r) return "none";
    const n = r.interval || 1;
    if (r.until || r.count) return "custom";
    if (r.freq === "daily" && n === 1) return "daily";
    if (r.freq === "weekly") {
      const days = (r.byDay || []).slice().sort().join(",");
      if (n === 1 && days === "1,2,3,4,5") return "weekdays";
      if (!r.byDay || r.byDay.length <= 1) return n === 1 ? "weekly" : n === 2 ? "biweekly" : "custom";
      return "custom";
    }
    if (r.freq === "monthly" && n === 1) return "monthly";
    if (r.freq === "yearly" && n === 1) return "yearly";
    return "custom";
  }

  const editor = { el: null, key: null, id: null, isNew: false, touched: false, checkpointed: false };
  M.editor = editor;

  editor.isOpen = () => !!editor.el;

  editor.open = function (key, anchor, { isNew = false } = {}) {
    const occ = M.store.findOcc(key);
    if (!occ) return;
    if (editor.el && editor.key === key) return;
    editor.close({ silent: true });
    Object.assign(editor, { key, id: occ.ev.id, isNew, touched: false, checkpointed: isNew, anchor });
    const el = h(`<div class="pop" role="dialog" aria-label="Event details"></div>`);
    editor.el = el;
    layer().appendChild(el);
    paint(occ);
    position(anchor);
    el.addEventListener("keydown", onKey);
    const title = $(".ed-title", el);
    if (isNew) { title.focus(); } else { el.setAttribute("tabindex", "-1"); el.focus(); }
  };

  editor.close = function ({ silent = false } = {}) {
    if (!editor.el) return;
    closeMenu();
    const el = editor.el;
    const ev = M.store.event(editor.id);
    const discard = editor.isNew && !editor.touched && ev && !ev.title;
    editor.el = null;
    const key = editor.key;
    editor.key = null;
    if (M.reducedMotion() || silent) el.remove();
    else { el.classList.add("leaving"); el.addEventListener("animationend", () => el.remove(), { once: true }); }
    if (discard) {
      // An untouched "New event" leaves no trace, not even in undo history.
      M.store.undoStack.pop();
      M.store.touch((d) => { d.events = d.events.filter((e) => e.id !== ev.id); }, "discard");
      if (M.state.selected === key) M.state.selected = null;
    }
    if (!silent) M.app.onEditorClosed();
  };

  editor.refresh = function () {
    if (!editor.el) return;
    const ev = M.store.event(editor.id);
    if (!ev) { editor.close({ silent: true }); return; }
    const occ = M.store.findOcc(editor.key) || { ev, start: D.parse(ev.start), end: D.parse(ev.end), recurring: !!ev.recurrence, key: editor.key };
    const focusSel = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f;
    paint(occ);
    if (focusSel) quietFocus($(`[data-f="${focusSel}"]`, editor.el));
  };

  function position(anchor) {
    const el = editor.el;
    const vw = innerWidth, vh = innerHeight;
    const w = el.offsetWidth, ph = el.offsetHeight;
    if (vw < 620 || !anchor || !anchor.isConnected) {
      el.style.left = `${(vw - w) / 2}px`;
      el.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
      el.style.transformOrigin = "center";
      return;
    }
    const r = anchor.getBoundingClientRect();
    let x = r.right + 10, origin = "left";
    if (x + w > vw - 12) { x = r.left - w - 10; origin = "right"; }
    if (x < 12) { x = M.clamp(r.left + r.width / 2 - w / 2, 12, vw - w - 12); origin = "center"; }
    const y = M.clamp(r.top + Math.min(r.height, 40) / 2 - 36, 12, vh - ph - 12);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transformOrigin = `${origin} ${M.clamp(r.top - y + 16, 0, ph)}px`;
  }
  editor.reposition = () => editor.el && position(editor.anchor);

  function paint(occ) {
    const ev = occ.ev;
    const cal = M.store.calendar(ev.calendarId);
    const s = occ.start, e = occ.end;
    const endShown = ev.allDay ? D.addDays(e, -1) : e;
    const rk = repeatKey(ev.recurrence);
    const alertList = ev.allDay ? ALL_DAY_ALERTS : ALERTS;
    const alert = ev.alerts && ev.alerts.length ? ev.alerts[0] : -1;
    const alertLabel = (alertList.find((a) => a.value === alert) || { label: alert >= 0 ? `${F.duration(alert)} before` : "None" }).label;
    const r = ev.recurrence;
    const ws = M.weekStart();
    const dayBtns = Array.from({ length: 7 }, (_, i) => (ws + i) % 7).map((dw) => {
      const on = r && r.freq === "weekly" && (r.byDay && r.byDay.length ? r.byDay : [D.parse(ev.start).getDay()]).includes(dw);
      const ref = D.addDays(D.startOfWeek(new Date(2026, 0, 4), 0), dw);
      return `<button type="button" data-dow="${dw}" aria-pressed="${!!on}" aria-label="${esc(F.weekday(ref))}">${esc(F.weekdayNarrow(ref))}</button>`;
    }).join("");
    const custom = rk === "custom" && r;
    const endsKind = r ? (r.until ? "until" : r.count ? "count" : "never") : "never";

    editor.el.style.setProperty("--c", cal.color);
    editor.el.innerHTML = `<div class="pop-body">
      <div class="ed-head"><span class="ed-swatch" style="--c:${cal.color}"></span>
        <input class="ed-title" data-f="title" type="text" placeholder="New event" value="${esc(ev.title)}" aria-label="Title" maxlength="200" spellcheck="true"></div>
      <input class="ed-loc" data-f="loc" type="text" placeholder="Add location" value="${esc(ev.location)}" aria-label="Location" maxlength="200">
      <div class="ed-sep"></div>
      <div class="ed-grid">
        <span class="ed-label" id="lbl-ad">All-day</span>
        <span class="ed-val"><button class="switch" type="button" role="switch" data-f="allday" aria-labelledby="lbl-ad" aria-checked="${ev.allDay}"></button></span>
        <span class="ed-label">Starts</span>
        <span class="ed-val"><button class="field" type="button" data-f="sdate">${esc(F.fieldDate(s))}</button>${ev.allDay ? "" : `<input class="field" data-f="stime" value="${esc(F.time(s))}" aria-label="Start time" inputmode="numeric">`}</span>
        <span class="ed-label">Ends</span>
        <span class="ed-val"><button class="field" type="button" data-f="edate">${esc(F.fieldDate(endShown))}</button>${ev.allDay ? "" : `<input class="field" data-f="etime" value="${esc(F.time(e))}" aria-label="End time" inputmode="numeric">`}</span>
        <span class="ed-label">Repeat</span>
        <span class="ed-val"><button class="field" type="button" data-f="repeat">${esc(rk === "custom" ? M.R.describe(r, D.parse(ev.start)) : REPEAT.find((x) => x.value === rk).label)}<svg class="caret" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></button></span>
        ${custom ? `
        <span class="ed-label">Every</span>
        <span class="ed-val"><input class="field ed-num" data-f="interval" value="${r.interval || 1}" aria-label="Interval" inputmode="numeric">
          <button class="field" type="button" data-f="freq">${({ daily: "days", weekly: "weeks", monthly: "months", yearly: "years" })[r.freq]}<svg class="caret" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></button></span>
        ${r.freq === "weekly" ? `<span class="ed-label">On</span><span class="ed-val"><span class="days-pick" role="group" aria-label="Repeat on">${dayBtns}</span></span>` : ""}` : ""}
        ${r ? `<span class="ed-label">End repeat</span>
        <span class="ed-val"><button class="field" type="button" data-f="ends">${endsKind === "never" ? "Never" : endsKind === "until" ? "On date" : "After"}<svg class="caret" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></button>
          ${endsKind === "until" ? `<button class="field" type="button" data-f="until">${esc(F.fieldDate(D.parse(r.until)))}</button>` : ""}
          ${endsKind === "count" ? `<input class="field ed-num" data-f="count" value="${r.count}" aria-label="Number of times" inputmode="numeric"><span class="ed-small">times</span>` : ""}</span>` : ""}
        <span class="ed-label">Alert</span>
        <span class="ed-val"><button class="field" type="button" data-f="alert">${M.icon.bell}${esc(alertLabel)}</button></span>
        <span class="ed-label">Calendar</span>
        <span class="ed-val"><button class="field" type="button" data-f="cal"><span class="sw" style="--c:${cal.color}"></span>${esc(cal.name)}<svg class="caret" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></button></span>
      </div>
      <div class="ed-sep"></div>
      <textarea class="ed-notes" data-f="notes" placeholder="Add notes" aria-label="Notes" rows="2" maxlength="5000">${esc(ev.notes)}</textarea>
    </div>
    <div class="ed-foot"><span class="hint"><i></i>${ev.recurrence ? "Details apply to every repeat" : "Saved automatically"}</span>
      <button class="btn danger plain" type="button" data-f="delete">${M.icon.trash}Delete</button></div>`;
    bind(occ);
    autosize($(".ed-notes", editor.el));
  }

  function autosize(t) { t.style.height = "auto"; t.style.height = `${Math.min(200, t.scrollHeight + 2)}px`; }

  /** Apply a non-temporal change to the event (series-wide for repeats). */
  function change(fn) {
    if (!editor.checkpointed) { M.store.checkpoint(); editor.checkpointed = true; }
    editor.touched = true;
    M.store.touch((d) => {
      const ev = d.events.find((x) => x.id === editor.id);
      if (ev) { fn(ev); ev.updated = new Date().toISOString(); }
    }, "editor");
  }

  /** Change the dates of the edited occurrence, asking for scope on repeats. */
  async function changeTimes(start, end) {
    const occ = M.store.findOcc(editor.key);
    if (!occ) return;
    if (end <= start) end = occ.ev.allDay ? D.addDays(start, 1) : D.addMinutes(start, 15);
    editor.touched = true;
    if (occ.recurring) {
      const scope = await M.askScope("change");
      if (!scope) { editor.refresh(); return; }
      // Follow the edited occurrence to its new home.
      editor.id = M.store.moveOcc(occ, start, end, scope);
      editor.key = `${editor.id}@${D.ymd(start)}`;
      editor.checkpointed = true;
    } else {
      if (!editor.checkpointed) { M.store.checkpoint(); editor.checkpointed = true; }
      const fmt = (x) => (occ.ev.allDay ? D.ymd(x) : D.iso(x));
      M.store.touch((d) => {
        const ev = d.events.find((x) => x.id === editor.id);
        ev.start = fmt(start); ev.end = fmt(end); ev.updated = new Date().toISOString();
      }, "editor");
      editor.key = `${editor.id}@${D.ymd(start)}`;
    }
    M.state.selected = editor.key;
    M.app.ensureVisible(start);
    editor.refresh();
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-key="${editor.key}"]`);
      if (target) { editor.anchor = target; position(target); }
    });
  }

  function bind(occ) {
    const el = editor.el;
    const q = (f) => $(`[data-f="${f}"]`, el);
    const ev = () => M.store.event(editor.id);

    q("title").addEventListener("input", (e) => change((x) => { x.title = e.target.value; }));
    q("loc").addEventListener("input", (e) => change((x) => { x.location = e.target.value; }));
    const notes = q("notes");
    notes.addEventListener("input", () => { autosize(notes); change((x) => { x.notes = notes.value; }); });
    [q("title"), q("loc")].forEach((f) => f.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); editor.close(); M.app.focusView(); }
    }));

    q("allday").addEventListener("click", () => {
      change((ev2) => {
        const s = D.parse(ev2.start), e = D.parse(ev2.end);
        if (ev2.allDay) {
          const hr = M.settings.day_start_hour ?? 9;
          const ns = new Date(s.getFullYear(), s.getMonth(), s.getDate(), Math.max(hr, 9));
          ev2.allDay = false; ev2.start = D.iso(ns); ev2.end = D.iso(D.addMinutes(ns, M.settings.default_duration || 60));
          ev2.alerts = M.settings.default_alert >= 0 ? [M.settings.default_alert] : [];
        } else {
          const last = D.startOfDay(new Date(e.getTime() - 1));
          ev2.allDay = true; ev2.start = D.ymd(s); ev2.end = D.ymd(D.addDays(last < s ? s : last, 1));
          ev2.alerts = [];
        }
      });
      editor.key = `${editor.id}@${D.ymd(D.parse(ev().start))}`;
      M.state.selected = editor.key;
      editor.refresh();
      q("allday") && q("allday").focus();
    });

    const cur = () => M.store.findOcc(editor.key) || occ;
    q("sdate").addEventListener("click", (e) => datePicker(e.currentTarget, cur().start, (d) => {
      const o = cur();
      const ns = new Date(d.getFullYear(), d.getMonth(), d.getDate(), o.start.getHours(), o.start.getMinutes());
      changeTimes(ns, new Date(ns.getTime() + (o.end - o.start)));
    }));
    q("edate").addEventListener("click", (e) => {
      const o = cur();
      const shown = o.ev.allDay ? D.addDays(o.end, -1) : o.end;
      datePicker(e.currentTarget, shown, (d) => {
        const ne = o.ev.allDay ? D.addDays(d, 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), o.end.getHours(), o.end.getMinutes());
        if (ne <= o.start) { flashInvalid(q("edate")); return; }
        changeTimes(o.start, ne);
      });
    });

    const wireTime = (f, isStart) => {
      const input = q(f);
      if (!input) return;
      const commit = () => {
        const o = cur();
        const min = parseTime(input.value);
        if (min == null) { flashInvalid(input); input.value = F.time(isStart ? o.start : o.end); return; }
        const base = D.startOfDay(isStart ? o.start : o.end);
        const t = D.addMinutes(base, min);
        if (isStart) {
          if (t.getTime() !== o.start.getTime()) changeTimes(t, new Date(t.getTime() + (o.end - o.start)));
        } else {
          let ne = t;
          if (ne <= o.start) ne = D.sameDay(o.start, o.end) ? D.addDays(ne, 1) : ne;
          if (ne <= o.start) { flashInvalid(input); input.value = F.time(o.end); return; }
          if (ne.getTime() !== o.end.getTime()) changeTimes(o.start, ne);
        }
      };
      const openList = () => {
        if (M.menuOpen() && openMenu.anchor === input) return;
        timeList(input, isStart ? cur().start : cur().end, (m) => { input.value = F.time(D.addMinutes(D.today(), m)); commit(); });
      };
      input.addEventListener("focus", () => {
        input.select();
        if (!quiet) openList();
      });
      input.addEventListener("click", openList); // re-open after Esc or a pick
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); closeMenu(); commit(); }
        else if (e.key === "ArrowDown" && M.menuOpen()) {
          e.preventDefault();
          const f2 = $(".menu .menu-item.on", layer()) || $(".menu .menu-item", layer());
          f2 && f2.focus({ preventScroll: true });
        }
        else if (e.key === "Escape" && M.menuOpen()) { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      });
      input.addEventListener("blur", () => setTimeout(() => {
        if (!editor.el || (M.menuOpen() && openMenu.el.contains(document.activeElement))) return;
        if (document.activeElement !== input) {
          if (M.menuOpen() && openMenu.anchor === input) closeMenu(); // only ever close *our* list
          commit();
        }
      }, 120));
    };
    wireTime("stime", true);
    wireTime("etime", false);

    q("repeat").addEventListener("click", (e) => {
      const x = ev();
      const rk = repeatKey(x.recurrence);
      M.menu(e.currentTarget, REPEAT.map((it) => ({ ...it, on: it.value === rk })), (v) => {
        const s = D.parse(x.start);
        const map = {
          none: null,
          daily: { freq: "daily", interval: 1 },
          weekdays: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] },
          weekly: { freq: "weekly", interval: 1, byDay: [s.getDay()] },
          biweekly: { freq: "weekly", interval: 2, byDay: [s.getDay()] },
          monthly: { freq: "monthly", interval: 1 },
          yearly: { freq: "yearly", interval: 1 },
          custom: x.recurrence ? { ...x.recurrence, until: x.recurrence.until || null } : { freq: "weekly", interval: 1, byDay: [s.getDay()] },
        };
        const next = map[v];
        change((y) => {
          y.recurrence = next ? { byDay: null, until: null, count: null, ...next } : null;
          if (v === "custom") y.recurrence._custom = true;
          if (!next) y.exdates = [];
        });
        // Editing the rule re-anchors the editor on the series' first occurrence.
        editor.key = `${editor.id}@${D.ymd(D.parse(ev().start))}`;
        M.state.selected = editor.key;
        editor.refresh();
      });
    });

    const interval = q("interval");
    if (interval) interval.addEventListener("change", () => {
      const n = M.clamp(parseInt(interval.value, 10) || 1, 1, 99);
      change((y) => { y.recurrence.interval = n; y.recurrence._custom = true; });
      editor.refresh();
    });
    const freq = q("freq");
    if (freq) freq.addEventListener("click", (e) => {
      const r = ev().recurrence;
      M.menu(e.currentTarget, [["daily", "days"], ["weekly", "weeks"], ["monthly", "months"], ["yearly", "years"]]
        .map(([v, l]) => ({ label: l, value: v, on: r.freq === v })), (v) => {
        change((y) => { y.recurrence.freq = v; y.recurrence.byDay = v === "weekly" ? [D.parse(y.start).getDay()] : null; y.recurrence._custom = true; });
        editor.refresh();
      });
    });
    $$("[data-dow]", el).forEach((b) => b.addEventListener("click", () => {
      const dw = Number(b.dataset.dow);
      change((y) => {
        const cur2 = new Set(y.recurrence.byDay && y.recurrence.byDay.length ? y.recurrence.byDay : [D.parse(y.start).getDay()]);
        if (cur2.has(dw)) { if (cur2.size > 1) cur2.delete(dw); } else cur2.add(dw);
        y.recurrence.byDay = Array.from(cur2).sort();
        y.recurrence._custom = true;
      });
      editor.refresh();
      const again = $(`[data-dow="${dw}"]`, editor.el); again && again.focus();
    }));
    const ends = q("ends");
    if (ends) ends.addEventListener("click", (e) => {
      const r = ev().recurrence;
      const kind = r.until ? "until" : r.count ? "count" : "never";
      M.menu(e.currentTarget, [{ label: "Never", value: "never" }, { label: "On date", value: "until" }, { label: "After a number of times", value: "count" }]
        .map((x) => ({ ...x, on: x.value === kind })), (v) => {
        change((y) => {
          y.recurrence._custom = true;
          if (v === "never") { y.recurrence.until = null; y.recurrence.count = null; }
          if (v === "until") { y.recurrence.count = null; y.recurrence.until = D.ymd(D.addMonths(D.parse(y.start), 3)); }
          if (v === "count") { y.recurrence.until = null; y.recurrence.count = 10; }
        });
        editor.refresh();
      });
    });
    const until = q("until");
    if (until) until.addEventListener("click", (e) => datePicker(e.currentTarget, D.parse(ev().recurrence.until), (d) => {
      const first = D.startOfDay(D.parse(ev().start));
      change((y) => { y.recurrence.until = D.ymd(d < first ? first : d); });
      editor.refresh();
    }));
    const count = q("count");
    if (count) count.addEventListener("change", () => {
      const n = M.clamp(parseInt(count.value, 10) || 1, 1, 999);
      change((y) => { y.recurrence.count = n; });
      editor.refresh();
    });

    q("alert").addEventListener("click", (e) => {
      const x = ev();
      const list = x.allDay ? ALL_DAY_ALERTS : ALERTS;
      const curA = x.alerts && x.alerts.length ? x.alerts[0] : -1;
      M.menu(e.currentTarget, list.map((a) => ({ ...a, on: a.value === curA })), (v) => {
        change((y) => { y.alerts = v === -1 ? [] : [v]; });
        editor.refresh();
      });
    });

    q("cal").addEventListener("click", (e) => {
      const x = ev();
      M.menu(e.currentTarget, M.store.data.calendars.map((c) => ({ label: c.name, value: c.id, sw: c.color, on: c.id === x.calendarId })), (id) => {
        change((y) => { y.calendarId = id; });
        M.state.lastCalendar = id;
        editor.refresh();
      });
    });

    q("delete").addEventListener("click", () => {
      const o = M.store.findOcc(editor.key);
      editor.isNew = false;
      editor.close({ silent: true });
      M.app.deleteOcc(o);
    });
  }

  function flashInvalid(el) {
    el.classList.remove("invalid"); void el.offsetWidth; el.classList.add("invalid");
    setTimeout(() => el.classList.remove("invalid"), 1200);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (M.menuOpen()) { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
      e.preventDefault(); e.stopPropagation();
      editor.close();
      M.app.focusView();
    }
  }

  // Close when clicking outside (the click still reaches what it hit).
  document.addEventListener("pointerdown", (e) => {
    if (!editor.el) return;
    if (editor.el.contains(e.target) || e.target.closest(".menu, .dialog-back")) return;
    if (e.target.closest(".ev, .bar, .mchip, .ag-item, .da-item, .up-item, .sp-item")) return; // re-anchors instead
    editor.close();
  }, true);
})(window.M);
