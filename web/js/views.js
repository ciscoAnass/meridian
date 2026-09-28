/* Views: month, week, day, agenda and the sidebar. Pure rendering. */
"use strict";
(function (M) {
  const { D, F, esc, h, $ } = M;
  const CHIP = 22;          // chip height + gap (month)
  const CELL_TOP = 28;      // space taken by the day number
  const LANE = 22;          // all-day lane height (week/day)

  const V = {};
  M.V = V;

  // ---------------------------------------------------------------- helpers
  const color = (o) => M.store.calendar(o.ev.calendarId).color;
  const titleOf = (o) => o.ev.title || "New event";
  const lastDay = (o) => (o.ev.allDay ? D.addDays(o.end, -1) : new Date(o.end.getTime() - 1));
  const isBar = (o) => o.ev.allDay || D.dayDiff(o.start, lastDay(o)) >= 1;
  const isPast = (o) => o.end < new Date();
  const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;

  /** Assign horizontal segments within a [start, start+cols) strip to lanes. */
  function laneSegments(occs, stripStart, cols) {
    const stripEnd = D.addDays(stripStart, cols);
    const segs = [];
    for (const o of occs) {
      if (!isBar(o)) continue;
      const ld = lastDay(o);
      if (o.start >= stripEnd || ld < stripStart) continue;
      const s = Math.max(0, D.dayDiff(stripStart, o.start));
      const e = Math.min(cols - 1, D.dayDiff(stripStart, ld));
      segs.push({ o, s, e, contL: o.start < stripStart, contR: ld >= stripEnd });
    }
    segs.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
    const lanes = [];
    for (const seg of segs) {
      let lane = lanes.findIndex((end) => end < seg.s);
      if (lane < 0) { lane = lanes.length; lanes.push(-1); }
      lanes[lane] = seg.e;
      seg.lane = lane;
    }
    return { segs, laneCount: lanes.length };
  }

  function barHTML(seg, cols, top, sel) {
    const o = seg.o;
    const left = `calc(${(seg.s * 100) / cols}% + ${seg.contL ? 0 : 3}px)`;
    const width = `calc(${((seg.e - seg.s + 1) * 100) / cols}% - ${(seg.contL ? 0 : 3) + (seg.contR ? 0 : 3)}px)`;
    const time = !o.ev.allDay && !seg.contL ? `<span class="tm">${F.time(o.start)}</span>` : "";
    const cls = ["bar", seg.contL && "cont-l", seg.contR && "cont-r", sel === o.key && "sel"].filter(Boolean).join(" ");
    return `<div class="${cls}" data-key="${o.key}" role="button" tabindex="0" aria-label="${esc(titleOf(o))}, ${esc(describeWhen(o))}"
      style="--c:${color(o)};left:${left};width:${width};top:${top}px">${time}<span class="t">${esc(titleOf(o))}</span></div>`;
  }

  function describeWhen(o) {
    if (o.ev.allDay) {
      const days = D.dayDiff(o.start, o.end);
      return days > 1 ? `${F.dayMonthShort(o.start)} – ${F.dayMonthShort(D.addDays(o.end, -1))}` : `${F.full(o.start)}, all day`;
    }
    if (!D.sameDay(o.start, lastDay(o))) return `${F.dayMonthShort(o.start)} ${F.time(o.start)} – ${F.dayMonthShort(o.end)} ${F.time(o.end)}`;
    return `${F.full(o.start)}, ${F.range(o.start, o.end)}`;
  }
  V.describeWhen = describeWhen;

  // ---------------------------------------------------------------- mounting
  function mount(node, anim) {
    const view = $("#view");
    node.classList.add("pane");
    if (anim && !M.reducedMotion()) node.classList.add(anim === "next" ? "enter-next" : anim === "prev" ? "enter-prev" : "enter-fade");
    view.replaceChildren(node);
  }

  V.render = function (anim) {
    const view = $("#view");
    const prevScroll = view.querySelector(".tg-scroll");
    const keepScroll = prevScroll && !anim ? prevScroll.scrollTop : null;
    const { view: kind } = M.state;
    let node;
    if (kind === "month") node = renderMonth();
    else if (kind === "week") node = renderTimeGrid(7);
    else if (kind === "day") node = renderDay();
    else node = renderAgenda();
    mount(node, anim);
    const scroller = node.querySelector(".tg-scroll");
    if (scroller) {
      scroller.scrollTop = keepScroll != null ? keepScroll : initialScroll(scroller);
      // Reserve the scrollbar's width in the header rows so columns line up.
      (node.matches(".tg") ? node : node.querySelector(".tg")).style.setProperty("--sb", `${scroller.offsetWidth - scroller.clientWidth}px`);
    }
    if (kind === "month") fitMonth(node);
    V.renderTitle(anim);
    V.updateNow();
  };

  function initialScroll(scroller) {
    const H = hourPx();
    const days = M.$$(".tg-col", scroller).map((c) => c.dataset.date);
    const today = D.ymd(new Date());
    const hour = days.includes(today) ? Math.max(0, new Date().getHours() - 2) : (M.settings.day_start_hour ?? 8);
    return hour * H;
  }

  V.renderTitle = function (anim) {
    const { view, date } = M.state;
    const title = $("#title"), sub = $("#subtitle");
    let html, text, subtitle = "";
    const yr = `<span class="light">${date.getFullYear()}</span>`;
    if (view === "month") {
      html = `${esc(F.month(date))} ${yr}`;
      text = `${F.month(date)} ${date.getFullYear()}`;
    } else if (view === "week") {
      const ws = D.startOfWeek(date, M.weekStart()), we = D.addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) html = `${esc(F.month(ws))} <span class="light">${ws.getFullYear()}</span>`;
      else if (ws.getFullYear() === we.getFullYear()) html = `${esc(F.monthShort(ws))} – ${esc(F.monthShort(we))} <span class="light">${we.getFullYear()}</span>`;
      else html = `${esc(F.monthShort(ws))} <span class="light">${ws.getFullYear()}</span> – ${esc(F.monthShort(we))} <span class="light">${we.getFullYear()}</span>`;
      text = title.textContent;
      subtitle = `Week ${D.isoWeek(D.addDays(ws, 3))}`;
    } else if (view === "day") {
      html = `${esc(F.dayMonth(date))} ${yr}`;
      subtitle = D.dayDiff(D.today(), date) === 0 ? `Today, ${F.weekday(date)}` : F.weekday(date);
    } else {
      html = "Upcoming";
      subtitle = D.sameDay(date, D.today()) ? "From today" : `From ${F.dayMonth(date)}`;
    }
    if (title.innerHTML !== html) {
      title.innerHTML = html;
      if (anim && !M.reducedMotion()) { title.classList.remove("swap"); void title.offsetWidth; title.classList.add("swap"); }
    }
    sub.textContent = subtitle;
    text = title.textContent;
    M.bridge.call("state", { view, title: text });
  };

  // ------------------------------------------------------------------ month
  function monthGeometry(date) {
    const first = D.startOfMonth(date);
    const start = D.startOfWeek(first, M.weekStart());
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const rows = Math.ceil((D.dayDiff(start, first) + dim) / 7);
    return { first, start, rows, end: D.addDays(start, rows * 7) };
  }
  V.monthGeometry = monthGeometry;

  function renderMonth() {
    const { date, selected } = M.state;
    const g = monthGeometry(date);
    const wk = !!M.settings.show_week_numbers;
    const today = D.today();
    const dows = Array.from({ length: 7 }, (_, i) => D.addDays(g.start, i));
    const node = h(`<div class="month${wk ? " wk" : ""}" style="--rows:${g.rows}">
      <div class="dow-row" role="row">${wk ? "<div></div>" : ""}${dows.map((d) => `<div class="dow" role="columnheader">${esc(F.weekdayShort(d))}</div>`).join("")}</div>
      <div class="mgrid" role="grid" aria-label="${esc(F.month(date))}"></div></div>`);
    const grid = node.querySelector(".mgrid");
    for (let r = 0; r < g.rows; r++) {
      const rowStart = D.addDays(g.start, r * 7);
      let cells = wk ? `<div class="wknum">${D.isoWeek(D.addDays(rowStart, 3))}</div>` : "";
      for (let c = 0; c < 7; c++) {
        const d = D.addDays(rowStart, c);
        const cls = ["mcell", d.getMonth() !== g.first.getMonth() && "out", D.sameDay(d, today) && "today",
          D.sameDay(d, date) && "sel", (d.getDay() === 0 || d.getDay() === 6) && "weekend"].filter(Boolean).join(" ");
        const label = d.getDate() === 1 ? `<span class="mlabel">${esc(F.monthShort(d))}</span>` : "";
        cells += `<div class="${cls}" role="gridcell" data-date="${D.ymd(d)}" aria-label="${esc(F.full(d))}">
          <div class="mhead">${label}<span class="mnum" data-goto="${D.ymd(d)}" role="button" title="Open ${esc(F.dayMonth(d))}">${d.getDate()}</span></div><div class="mitems"></div></div>`;
      }
      grid.insertAdjacentHTML("beforeend", `<div class="mrow" data-start="${D.ymd(rowStart)}">${cells}<div class="mbars"></div></div>`);
    }
    node._geom = g;
    node._selected = selected;
    return node;
  }

  /** Second pass once we know real cell heights: place bars, chips and "+N more". */
  function fitMonth(node) {
    const g = node._geom;
    const selected = node._selected;
    const occs = M.store.range(g.start, g.end);
    const rows = node.querySelectorAll(".mrow");
    const rowH = rows[0] ? rows[0].clientHeight : 100;
    const cap = Math.max(1, Math.floor((rowH - CELL_TOP - 2) / CHIP));
    rows.forEach((row) => {
      const rowStart = D.parse(row.dataset.start);
      const { segs, laneCount } = laneSegments(occs, rowStart, 7);
      const timed = Array.from({ length: 7 }, () => []);
      for (const o of occs) {
        if (isBar(o)) continue;
        const c = D.dayDiff(rowStart, o.start);
        if (c >= 0 && c < 7) timed[c].push(o);
      }
      const overflow = timed.some((t) => laneCount + t.length > cap);
      const L = overflow ? Math.min(laneCount, cap - 1) : laneCount;
      row.querySelector(".mbars").innerHTML = segs.filter((s) => s.lane < L)
        .map((s) => barHTML(s, 7, CELL_TOP + s.lane * CHIP, selected)).join("");
      const cells = row.querySelectorAll(".mcell");
      for (let c = 0; c < 7; c++) {
        const hiddenBars = segs.filter((s) => s.lane >= L && s.s <= c && s.e >= c).length;
        const list = timed[c];
        const slots = cap - L;
        const needMore = list.length + hiddenBars > slots;
        const shown = needMore ? list.slice(0, Math.max(0, slots - 1)) : list;
        const hidden = list.length - shown.length + hiddenBars;
        const items = cells[c].querySelector(".mitems");
        items.style.paddingTop = `${L * CHIP}px`;
        items.innerHTML = shown.map((o) => `<div class="mchip${o.key === selected ? " sel" : ""}${isPast(o) ? " past" : ""}" data-key="${o.key}" role="button" tabindex="0"
            style="--c:${color(o)}" aria-label="${esc(titleOf(o))}, ${esc(describeWhen(o))}"><span class="dot"></span><span class="t">${esc(titleOf(o))}</span><span class="tm">${F.time(o.start)}</span></div>`).join("")
          + (hidden > 0 ? `<button class="more" type="button" data-more="${cells[c].dataset.date}">${hidden} more</button>` : "");
      }
    });
  }
  V.refitMonth = () => { const n = $("#view .month"); if (n) fitMonth(n); };

  // -------------------------------------------------------------- time grid
  function layoutColumn(items) {
    items.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
    let cluster = [], cols = [], clusterEnd = -1;
    const finalize = () => {
      const n = cols.length;
      cluster.forEach((it) => {
        // Let an event widen into free columns to its right.
        let span = 1;
        for (let k = it.col + 1; k < n; k++) {
          if (cols[k].some((o) => o.s < it.e && o.e > it.s)) break;
          span++;
        }
        it.left = it.col / n; it.width = span / n;
      });
      cluster = []; cols = [];
    };
    for (const it of items) {
      if (it.s >= clusterEnd && cluster.length) finalize();
      let col = cols.findIndex((c) => c[c.length - 1].e <= it.s);
      if (col < 0) { col = cols.length; cols.push([]); }
      cols[col].push(it);
      it.col = col;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    }
    if (cluster.length) finalize();
    return items;
  }

  function renderTimeGrid(days, startOverride) {
    const { date, selected } = M.state;
    const start = startOverride || (days === 1 ? D.startOfDay(date) : D.startOfWeek(date, M.weekStart()));
    const end = D.addDays(start, days);
    const occs = M.store.range(start, end);
    const today = D.today();
    const H = hourPx();
    const dayList = Array.from({ length: days }, (_, i) => D.addDays(start, i));

    const heads = dayList.map((d) => {
      const cls = ["tg-dayhead", D.sameDay(d, today) && "today", (d.getDay() === 0 || d.getDay() === 6) && "weekend"].filter(Boolean).join(" ");
      const label = days === 1 ? F.weekday(d) : F.weekdayShort(d);
      return `<button class="${cls}" type="button" data-goto="${D.ymd(d)}" aria-label="${esc(F.full(d))}"><span>${esc(label)}</span><span class="n">${d.getDate()}</span></button>`;
    }).join("");

    const { segs, laneCount } = laneSegments(occs, start, days);
    const lanesH = Math.max(1, laneCount) * LANE + 6;
    const adCols = dayList.map((_, i) => `<div class="dcol" style="left:${(i * 100) / days}%;width:${100 / days}%"></div>`).join("");
    const bars = segs.map((s) => barHTML(s, days, 3 + s.lane * LANE, selected)).join("");

    const hours = Array.from({ length: 23 }, (_, i) => `<div class="hr" data-h="${i + 1}" style="top:${(i + 1) * H}px">${F.hourLabel(i + 1)}</div>`).join("");

    const cols = dayList.map((d) => {
      const dayStart = d, dayEnd = D.addDays(d, 1);
      const items = [];
      for (const o of occs) {
        if (isBar(o)) continue;
        if (o.end <= dayStart || o.start >= dayEnd) continue;
        const s = Math.max(0, (Math.max(o.start, dayStart) - dayStart) / D.MIN);
        const e = Math.min(1440, (Math.min(o.end, dayEnd) - dayStart) / D.MIN);
        items.push({ o, s, e: Math.max(e, s + 15) });
      }
      layoutColumn(items);
      const blocks = items.map((it) => eventBlock(it, H, selected)).join("");
      const cls = ["tg-col", D.sameDay(d, today) && "today", (d.getDay() === 0 || d.getDay() === 6) && "weekend"].filter(Boolean).join(" ");
      return `<div class="${cls}" data-date="${D.ymd(d)}" role="gridcell" aria-label="${esc(F.full(d))}">${blocks}</div>`;
    }).join("");

    return h(`<div class="tg${days === 1 ? " single" : ""}" style="--days:${days}" data-start="${D.ymd(start)}">
      <div class="tg-head"><div></div><div class="tg-days">${heads}</div></div>
      <div class="tg-allday"><div class="tg-adlabel">all-day</div><div class="tg-adlane" data-start="${D.ymd(start)}" style="height:${lanesH}px">${adCols}${bars}</div></div>
      <div class="tg-scroll"><div class="tg-body">
        <div class="tg-gutter">${hours}</div>
        <div class="tg-cols" role="grid">${cols}</div>
      </div></div></div>`);
  }

  function eventBlock(it, H, selected) {
    const o = it.o;
    const top = (it.s / 60) * H;
    const height = Math.max(((it.e - it.s) / 60) * H - 2, H / 4 - 2);
    const dur = it.e - it.s;
    const cls = ["ev", dur <= 45 && "short", dur <= 20 && "tiny", isPast(o) && "past", o.key === selected && "sel"].filter(Boolean).join(" ");
    const inset = 2, gap = 2;
    const style = `--c:${color(o)};top:${top + 1}px;height:${height}px;left:calc(${it.left * 100}% + ${inset}px);width:calc(${it.width * 100}% - ${inset + gap + (it.left + it.width < 0.999 ? 0 : 1)}px)`;
    const time = dur <= 45 ? F.time(o.start) : F.range(o.start, o.end);
    const loc = dur >= 75 && o.ev.location ? `<div class="ev-loc">${esc(o.ev.location)}</div>` : "";
    return `<div class="${cls}" data-key="${o.key}" role="button" tabindex="0" style="${style}" aria-label="${esc(titleOf(o))}, ${esc(describeWhen(o))}">
      <div class="ev-t">${esc(titleOf(o))}</div><div class="ev-m">${time}</div>${loc}<div class="ev-handle" data-resize="1"></div></div>`;
  }

  // --------------------------------------------------------------- day view
  function renderDay() {
    const { date } = M.state;
    const node = h(`<div class="dayview"></div>`);
    node.appendChild(renderTimeGrid(1));
    const occs = M.store.range(D.startOfDay(date), D.addDays(D.startOfDay(date), 1));
    const aside = h(`<aside class="day-aside" aria-label="Day summary"></aside>`);
    const n = occs.length;
    aside.innerHTML = `<h3>Schedule</h3><p class="da-sub">${n ? `${n} event${n > 1 ? "s" : ""}` : "Nothing scheduled"}</p>`
      + (n ? occs.map((o) => `<button class="da-item" type="button" data-key="${o.key}" style="--c:${color(o)}"><i></i><span>
          <b>${esc(titleOf(o))}</b><small>${o.ev.allDay ? "All day" : esc(F.range(o.start, o.end))}</small>${o.ev.location ? `<small>${esc(o.ev.location)}</small>` : ""}</span></button>`).join("")
        : `<p class="da-empty">Click any hour to add an event, or drag to choose its length.</p>`);
    node.appendChild(aside);
    return node;
  }

  // ----------------------------------------------------------------- agenda
  function renderAgenda() {
    const start = D.startOfDay(M.state.date);
    const span = M.state.agendaDays || 60;
    const end = D.addDays(start, span);
    const occs = M.store.range(start, end);
    const today = D.today();
    const node = h(`<div class="agenda" role="list"><div class="ag-inner"></div></div>`);
    const inner = node.firstElementChild;
    if (!occs.length) {
      node.innerHTML = `<div class="empty"><div class="empty-inner">
        <div class="empty-mark"><svg viewBox="0 0 48 48"><rect x="7" y="10" width="34" height="31" rx="6"/><path d="M7 19h34M16 6v8M32 6v8"/><path d="M18 30h12" opacity=".5"/></svg></div>
        <h3>Nothing in the next ${span} days</h3><p>Your schedule is clear. Add an event to see it here.</p>
        <button class="btn primary" type="button" data-action="new">New event</button></div></div>`;
      return node;
    }
    const byDay = new Map();
    for (let i = 0; i < span; i++) byDay.set(D.ymd(D.addDays(start, i)), []);
    for (const o of occs) {
      let d = D.startOfDay(o.start < start ? start : o.start);
      const ld = lastDay(o);
      while (d <= ld && d < end) { byDay.get(D.ymd(d)).push(o); d = D.addDays(d, 1); }
    }
    let html = "";
    for (const [ymd, list] of byDay) {
      if (!list.length) continue;
      const d = D.parse(ymd);
      const isToday = D.sameDay(d, today);
      const rel = D.dayDiff(today, d);
      const relText = rel === 0 ? "Today" : rel === 1 ? "Tomorrow" : F.weekday(d);
      html += `<section class="ag-day${isToday ? " today" : ""}" role="listitem" aria-label="${esc(F.full(d))}">
        <div class="ag-date"><b>${d.getDate()} ${esc(F.monthShort(d))}</b><small>${esc(relText)}</small></div><div class="ag-list">`;
      for (const o of list) {
        let time;
        if (o.ev.allDay) time = "All day";
        else if (!D.sameDay(o.start, d) && !D.sameDay(lastDay(o), d)) time = "All day";
        else if (!D.sameDay(o.start, d)) time = `Until ${F.time(o.end)}`;
        else if (!D.sameDay(lastDay(o), d)) time = `From ${F.time(o.start)}`;
        else time = `${F.time(o.start)}<small>${F.time(o.end)}</small>`;
        const meta = [
          o.ev.location && `<span>${M.icon.pin}${esc(o.ev.location)}</span>`,
          o.recurring && `<span>${M.icon.repeat}${esc(M.R.describe(o.ev.recurrence, D.parse(o.ev.start)))}</span>`,
        ].filter(Boolean).join("");
        html += `<button class="ag-item${o.key === M.state.selected ? " sel" : ""}" type="button" data-key="${o.key}" style="--c:${color(o)}">
          <span class="ag-time">${time}</span><span class="ag-bar"></span>
          <span><div class="ag-title">${esc(titleOf(o))}</div>${meta ? `<div class="ag-meta">${meta}</div>` : ""}</span></button>`;
      }
      html += `</div></section>`;
    }
    inner.innerHTML = html + `<button class="btn plain ag-more" type="button" data-action="agenda-more">Show more</button>`;
    return node;
  }

  // ------------------------------------------------------------- now line
  V.updateNow = function () {
    M.$$(".now-line, .now-pill, .now-faint").forEach((n) => n.remove());
    M.$$(".hr.hide").forEach((n) => n.classList.remove("hide"));
    const col = document.querySelector(`.tg-col[data-date="${D.ymd(new Date())}"]`);
    if (!col) return;
    const H = hourPx();
    const now = new Date();
    const y = (D.minutesOfDay(now) / 60) * H;
    col.appendChild(h(`<div class="now-line" style="top:${y}px" aria-hidden="true"></div>`));
    const cols = col.parentElement;
    if (cols.children.length > 1) cols.appendChild(h(`<div class="now-faint" style="top:${y + 0.5}px" aria-hidden="true"></div>`));
    const gutter = cols.parentElement.querySelector(".tg-gutter");
    gutter.appendChild(h(`<div class="now-pill" style="top:${y}px">${F.time(now)}</div>`));
    gutter.querySelectorAll(".hr").forEach((hr) => {
      if (Math.abs(parseFloat(hr.style.top) - y) < 12) hr.classList.add("hide");
    });
  };

  // ---------------------------------------------------------------- sidebar
  V.renderSidebar = function () {
    renderMini();
    renderCalendars();
    renderUpNext();
  };

  function miniGrid(month, opts = {}) {
    const ws = M.weekStart();
    const first = D.startOfMonth(month);
    const start = D.startOfWeek(first, ws);
    const today = D.today();
    const wk = opts.weeks;
    const has = new Set();
    if (opts.dots) {
      for (const o of M.store.range(start, D.addDays(start, 42))) {
        let d = D.startOfDay(o.start); const ld = lastDay(o);
        while (d <= ld) { has.add(D.ymd(d)); d = D.addDays(d, 1); }
      }
    }
    const selWeek = opts.week ? D.startOfWeek(opts.week, ws) : null;
    let html = wk ? `<div></div>` : "";
    for (let i = 0; i < 7; i++) html += `<div class="mini-dow">${esc(F.weekdayNarrow(D.addDays(start, i)))}</div>`;
    for (let i = 0; i < 42; i++) {
      const d = D.addDays(start, i);
      if (wk && i % 7 === 0) html += `<div class="mini-wk">${D.isoWeek(D.addDays(d, 3))}</div>`;
      const cls = ["mini-day", d.getMonth() !== first.getMonth() && "out", D.sameDay(d, today) && "today",
        opts.selected && D.sameDay(d, opts.selected) && "sel", has.has(D.ymd(d)) && "has",
        selWeek && D.dayDiff(selWeek, d) >= 0 && D.dayDiff(selWeek, d) < 7 && "inweek"].filter(Boolean).join(" ");
      html += `<button class="${cls}" type="button" data-date="${D.ymd(d)}" aria-label="${esc(F.full(d))}" tabindex="-1"><span>${d.getDate()}</span></button>`;
    }
    return `<div class="mini-head"><span class="mini-title">${esc(F.month(first))} <span class="light">${first.getFullYear()}</span></span>
      <span class="mini-nav"><button class="icon-btn" type="button" data-mini="-1" aria-label="Previous month">${M.icon.chevL}</button>
      <button class="icon-btn" type="button" data-mini="1" aria-label="Next month">${M.icon.chevR}</button></span></div>
      <div class="mini-grid${wk ? " wk" : ""}">${html}</div>`;
  }
  V.miniGrid = miniGrid;

  function renderMini() {
    const { miniMonth, date, view } = M.state;
    $("#mini").innerHTML = miniGrid(miniMonth, {
      dots: true, selected: date, weeks: M.settings.show_week_numbers,
      week: view === "week" ? date : null,
    });
  }

  function renderCalendars() {
    const list = $("#cal-list");
    list.innerHTML = M.store.data.calendars.map((c) => `<li class="cal-item${c.visible ? "" : " off"}" data-cal="${c.id}">
      <button class="cal-toggle" type="button" role="checkbox" aria-checked="${c.visible}" data-toggle="${c.id}">
        <span class="cal-check" style="--c:${c.color}">${M.icon.check}</span><span class="cal-name">${esc(c.name)}</span></button>
      <button class="icon-btn cal-more" type="button" data-calmenu="${c.id}" aria-label="Options for ${esc(c.name)}">${M.icon.more}</button></li>`).join("");
  }

  function renderUpNext() {
    const now = new Date();
    const upcoming = M.store.range(now, D.addDays(now, 7)).filter((o) => !o.ev.allDay && o.end > now).slice(0, 3);
    const el = $("#upnext");
    el.innerHTML = `<h2>Up next</h2>` + (upcoming.length
      ? upcoming.map((o) => {
        const started = o.start <= now;
        const when = started ? `Now, until ${F.time(o.end)}` : `${F.relativeDay(o.start)}, ${F.time(o.start)}`;
        return `<button class="up-item" type="button" data-key="${o.key}" style="--c:${color(o)}"><i></i><span><b>${esc(titleOf(o))}</b><small>${esc(when)}</small></span></button>`;
      }).join("")
      : `<p class="up-empty">Nothing in the next 7 days.</p>`);
  }
})(window.M);
