/* Direct manipulation: drag to create, move, resize, and drop between days. */
"use strict";
(function (M) {
  const { D, F, $, $$, esc, h } = M;
  const THRESHOLD = 4;
  const I = {};
  M.I = I;
  let drag = null;
  let suppressClick = false;
  let hadOverlay = false;

  const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;

  function colAt(x, cols) {
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x < r.right) return c;
    }
    const first = cols[0].getBoundingClientRect();
    return x < first.left ? cols[0] : cols[cols.length - 1];
  }
  const minutesAt = (y, col) => ((y - col.getBoundingClientRect().top) / hourPx()) * 60;

  // ----------------------------------------------------------------- setup
  I.init = function () {
    const view = $("#view");
    // Capture on window runs before the editor's outside-click handler closes it.
    window.addEventListener("pointerdown", () => {
      hadOverlay = M.editor.isOpen() || M.menuOpen() || !!document.querySelector(".dialog-back");
    }, true);
    view.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
    // Swallow the click that follows a drag.
    view.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
  };

  function onDown(e) {
    if (e.button !== 0 || drag) return;
    const evEl = e.target.closest(".ev, .bar, .mchip");
    const col = e.target.closest(".tg-col");
    const lane = e.target.closest(".tg-adlane");
    const cell = e.target.closest(".mcell");
    const control = e.target.closest("button, .mnum, [data-goto], [data-more]");
    if (evEl) {
      const occ = M.store.findOcc(evEl.dataset.key);
      if (!occ) return;
      if (evEl.classList.contains("ev")) {
        drag = { kind: e.target.dataset.resize ? "resize" : "move", el: evEl, occ, col: evEl.closest(".tg-col") };
      } else {
        drag = { kind: "day", el: evEl, occ };
      }
    } else if (col) {
      drag = { kind: "create", col };
    } else if (lane && !control) {
      drag = { kind: "lane", lane };
    } else if (cell && !control) {
      drag = { kind: "cell", cell };
    } else {
      return;
    }
    drag.hadOverlay = hadOverlay;
    Object.assign(drag, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId });
    if (drag.kind !== "create") e.preventDefault(); // keep focus behaviour tidy
  }

  function onMove(e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < THRESHOLD) return;
      drag.moved = true;
      begin();
    }
    e.preventDefault();
    if (!drag.inert) update();
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    if (!d.moved) {
      drag = null;
      if (d.el) { M.app.openOcc(d.occ.key, d.el); return; }
      // Click on empty space: create there (Google-style). If something was
      // open, this click only dismisses it.
      if (d.hadOverlay) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      clickCreate(d, e);
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!d.inert) finish(d);
    cleanup();
  }

  function clickCreate(d, e) {
    const dur = M.settings.default_duration || 60;
    if (d.kind === "create") {
      const min = M.clamp(Math.floor(minutesAt(e.clientY, d.col) / 30) * 30, 0, 1440 - 30);
      const start = D.addMinutes(D.parse(d.col.dataset.date), min);
      M.app.createAt(start, D.addMinutes(start, Math.min(dur, 1440 - min)), false);
    } else if (d.kind === "lane") {
      const day = dayAt(e.clientX, e.clientY);
      if (day) M.app.createAt(day, D.addDays(day, 1), true);
    } else if (d.kind === "cell") {
      const day = D.parse(d.cell.dataset.date);
      const now = new Date();
      const hour = D.sameDay(day, now) ? Math.min(23, now.getHours() + 1) : 9;
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);
      M.app.createAt(start, D.addMinutes(start, dur), false);
    }
  }

  function cancel() { if (drag) cleanup(); }

  function cleanup() {
    if (!drag) return;
    clearInterval(drag.scrollTimer);
    drag.ghost && drag.ghost.remove();
    drag.float && drag.float.remove();
    drag.el && drag.el.classList.remove("dragging-src");
    $$(".mcell.drop").forEach((c) => c.classList.remove("drop"));
    document.body.classList.remove("is-dragging", "is-resizing");
    drag = null;
  }
  I.cancel = cancel;
  I.active = () => !!drag;

  // --------------------------------------------------------------- phases
  function begin() {
    const d = drag;
    if (d.kind === "cell" || d.kind === "lane") { d.inert = true; return; }
    M.editor.close();
    if (d.kind === "move" || d.kind === "resize" || d.kind === "create") {
      d.cols = $$(".tg-col");
      d.scroller = $(".tg-scroll");
      d.scrollTimer = setInterval(autoScroll, 16);
      const col0 = d.col || colAt(d.x0, d.cols);
      d.startCol = col0;
      if (d.kind === "move") {
        const dayStart = D.parse(col0.dataset.date);
        d.grabMin = minutesAt(d.y0, col0) - (d.occ.start - dayStart) / D.MIN;
        d.dur = (d.occ.end - d.occ.start) / D.MIN;
        d.el.classList.add("dragging-src");
        document.body.classList.add("is-dragging");
      } else if (d.kind === "resize") {
        document.body.classList.add("is-resizing");
      } else {
        d.anchorMin = M.clamp(Math.floor(minutesAt(d.y0, col0) / 15) * 15, 0, 1425);
      }
      d.ghost = h(`<div class="ghost"></div>`);
    } else if (d.kind === "day") {
      const r = d.el.getBoundingClientRect();
      d.float = d.el.cloneNode(true);
      d.float.classList.add("drag-float");
      d.float.classList.remove("sel", "cont-l", "cont-r");
      Object.assign(d.float.style, { width: `${Math.min(r.width, 240)}px`, height: `${r.height}px`, left: "0", top: "0", position: "fixed" });
      d.offX = Math.min(d.x0 - r.left, 60);
      d.offY = d.y0 - r.top;
      document.body.appendChild(d.float);
      d.el.classList.add("dragging-src");
      document.body.classList.add("is-dragging");
      d.grabDay = dayAt(d.x0, d.y0) || D.startOfDay(d.occ.start);
    }
  }

  function update() {
    const d = drag;
    if (d.kind === "day") {
      d.float.style.transform = `translate(${d.x - d.offX}px, ${d.y - d.offY}px) rotate(-1deg)`;
      const day = dayAt(d.x, d.y);
      $$(".mcell.drop").forEach((c) => c.classList.remove("drop"));
      if (day) {
        const cell = document.querySelector(`.mcell[data-date="${D.ymd(day)}"]`);
        cell && cell.classList.add("drop");
      }
      d.target = day;
      return;
    }
    const H = hourPx();
    let col, s, e;
    if (d.kind === "move") {
      col = colAt(d.x, d.cols);
      s = M.clamp(D.snap(minutesAt(d.y, col) - d.grabMin), 0, 1440 - 15);
      e = s + d.dur;
    } else if (d.kind === "resize") {
      col = d.startCol;
      const dayStart = D.parse(col.dataset.date);
      const segStart = Math.max(0, (d.occ.start - dayStart) / D.MIN);
      s = segStart;
      e = M.clamp(D.snap(minutesAt(d.y, col)), segStart + 15, 1440);
    } else {
      col = d.startCol;
      const cur = M.clamp(minutesAt(d.y, col), 0, 1440);
      const a = d.anchorMin;
      if (cur >= a) { s = a; e = Math.max(a + 15, Math.ceil(cur / 15) * 15); }
      else { s = Math.floor(cur / 15) * 15; e = a + 15; }
      e = Math.min(e, 1440);
    }
    d.result = { col, s, e };
    const cal = d.occ ? M.store.calendar(d.occ.ev.calendarId) : M.store.calendar(M.state.lastCalendar);
    const base = D.parse(col.dataset.date);
    const label = `${F.time(D.addMinutes(base, s))} – ${F.time(D.addMinutes(base, e))}`;
    d.ghost.style.cssText = `--c:${cal.color};top:${(s / 60) * H + 1}px;height:${Math.max(((e - s) / 60) * H - 2, 12)}px`;
    d.ghost.className = `ghost${d.kind === "create" ? " creating" : ""}`;
    d.ghost.innerHTML = `${d.occ ? `<div>${esc(d.occ.ev.title || "New event")}</div>` : `<div>New event</div>`}<div style="font-weight:500;opacity:.8">${label}</div>`;
    if (d.ghost.parentElement !== col) col.appendChild(d.ghost);
  }

  function autoScroll() {
    const d = drag;
    if (!d || !d.scroller || !d.moved) return;
    const r = d.scroller.getBoundingClientRect();
    const edge = 44;
    let v = 0;
    if (d.y < r.top + edge) v = -Math.ceil((r.top + edge - d.y) / 4);
    else if (d.y > r.bottom - edge) v = Math.ceil((d.y - (r.bottom - edge)) / 4);
    if (v) { d.scroller.scrollTop += v; update(); }
  }

  function dayAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const cell = el.closest && el.closest(".mcell");
      if (cell) return D.parse(cell.dataset.date);
      const lane = el.closest && el.closest(".tg-adlane");
      if (lane) {
        const r = lane.getBoundingClientRect();
        const days = Number(getComputedStyle(lane.closest(".tg")).getPropertyValue("--days")) || 7;
        const i = M.clamp(Math.floor(((x - r.left) / r.width) * days), 0, days - 1);
        return D.addDays(D.parse(lane.dataset.start), i);
      }
      const col = el.closest && el.closest(".tg-col");
      if (col) return D.parse(col.dataset.date);
    }
    return null;
  }

  function finish(d) {
    if (d.kind === "day") {
      if (!d.target) return;
      const delta = D.dayDiff(d.grabDay, d.target);
      if (!delta) return;
      const o = d.occ;
      const start = D.addDays(o.start, delta), end = D.addDays(o.end, delta);
      M.app.applyMove(o, start, end);
      return;
    }
    if (!d.result) return;
    const { col, s, e } = d.result;
    const base = D.parse(col.dataset.date);
    const start = D.addMinutes(base, s), end = D.addMinutes(base, e);
    if (d.kind === "create") {
      M.app.createAt(start, end, false);
    } else if (d.kind === "move") {
      if (start.getTime() === d.occ.start.getTime()) return;
      M.app.applyMove(d.occ, start, end);
    } else if (d.kind === "resize") {
      const newEnd = end;
      if (newEnd.getTime() === d.occ.end.getTime()) return;
      M.app.applyMove(d.occ, d.occ.start, newEnd);
    }
  }

})(window.M);
