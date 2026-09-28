/* Recurrence: expand events into concrete occurrences within a range.
 *
 * Event times are "floating" local times ("2026-09-28T10:00"), which is what a
 * personal calendar wants: 10:00 means 10:00 wherever you are.
 *
 * recurrence = { freq: "daily"|"weekly"|"monthly"|"yearly", interval: n,
 *                byDay: [0..6] (weekly only), until: "YYYY-MM-DD"|null, count: n|null }
 */
"use strict";
(function (M) {
  const { D } = M;
  const MAX_STEPS = 50000;

  function span(ev) {
    const s = D.parse(ev.start), e = D.parse(ev.end);
    return ev.allDay ? { s, days: Math.max(1, D.dayDiff(s, e)) } : { s, ms: Math.max(0, e - s) };
  }

  function makeOcc(ev, start, sp, recurring) {
    const end = ev.allDay ? D.addDays(start, sp.days) : new Date(start.getTime() + sp.ms);
    return { ev, start, end, recurring, key: `${ev.id}@${D.ymd(start)}`, date: D.ymd(start) };
  }

  // Yields candidate starts in chronological order.
  function* candidates(ev, s) {
    const r = ev.recurrence;
    const n = Math.max(1, r.interval | 0 || 1);
    const h = s.getHours(), mi = s.getMinutes();
    if (r.freq === "daily") {
      for (let k = 0; ; k++) yield D.addDays(s, k * n);
    } else if (r.freq === "weekly") {
      const days = (r.byDay && r.byDay.length ? r.byDay.slice() : [s.getDay()]).sort((a, b) => a - b);
      const week0 = D.startOfWeek(s, 0);
      for (let w = 0; ; w++) {
        const base = D.addDays(week0, w * 7 * n);
        for (const dow of days) {
          const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dow, h, mi);
          if (d >= s) yield d;
        }
      }
    } else if (r.freq === "monthly") {
      const day = s.getDate();
      for (let k = 0; ; k++) {
        const d = new Date(s.getFullYear(), s.getMonth() + k * n, day, h, mi);
        if (d.getDate() === day) yield d; // skip months without this day
        else yield null;
      }
    } else if (r.freq === "yearly") {
      for (let k = 0; ; k++) {
        const d = new Date(s.getFullYear() + k * n, s.getMonth(), s.getDate(), h, mi);
        yield d.getMonth() === s.getMonth() ? d : null;
      }
    }
  }

  /** All occurrences of `ev` overlapping [from, to). */
  function occurrences(ev, from, to) {
    const sp = span(ev);
    if (!ev.recurrence) {
      const o = makeOcc(ev, sp.s, sp, false);
      return o.start < to && o.end > from ? [o] : (o.start.getTime() === o.end.getTime() && o.start >= from && o.start < to ? [o] : []);
    }
    const r = ev.recurrence;
    const until = r.until ? D.addDays(D.parse(r.until), 1) : null;
    const ex = new Set(ev.exdates || []);
    const out = [];
    let count = 0, steps = 0;
    const lookback = ev.allDay ? sp.days * D.DAY : sp.ms;
    for (const d of candidates(ev, sp.s)) {
      if (++steps > MAX_STEPS) break;
      if (d === null) continue;
      if (until && d >= until) break;
      if (r.count && count >= r.count) break;
      count++;
      if (d >= to) break;
      if (d.getTime() + lookback < from.getTime() && !(lookback === 0 && d >= from)) continue;
      if (ex.has(D.ymd(d))) continue;
      const o = makeOcc(ev, d, sp, true);
      if (o.end > from || (o.start >= from && o.start < to)) out.push(o);
    }
    return out;
  }

  /** The next occurrence at or after `after` (or the last one if none). */
  function nextOccurrence(ev, after = new Date()) {
    const horizon = D.addDays(after, 366 * 3);
    const found = occurrences(ev, after, horizon);
    if (found.length) return found[0];
    const past = occurrences(ev, D.addDays(after, -366 * 5), after);
    return past[past.length - 1] || null;
  }

  function describe(r, start) {
    if (!r) return "Does not repeat";
    const n = r.interval || 1;
    const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.freq];
    let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
    if (r.freq === "weekly") {
      const days = (r.byDay && r.byDay.length ? r.byDay : [start.getDay()]).slice().sort();
      const key = days.join(",");
      if (key === "1,2,3,4,5" && n === 1) text = "Every weekday";
      else if (key === "0,6" && n === 1) text = "Every weekend";
      else if (days.length > 1 || days[0] !== start.getDay()) {
        const ref = D.startOfWeek(new Date(2026, 0, 4), 0);
        const ordered = days.slice().sort((a, b) => ((a - M.weekStart() + 7) % 7) - ((b - M.weekStart() + 7) % 7));
        text += " on " + ordered.map((d) => M.F.weekdayShort(D.addDays(ref, d))).join(", ");
      }
    } else if (r.freq === "monthly") {
      text += ` on day ${start.getDate()}`;
    }
    if (r.until) text += `, until ${M.F.dayMonthShort(D.parse(r.until))}`;
    else if (r.count) text += `, ${r.count} times`;
    return text;
  }

  M.R = { occurrences, nextOccurrence, describe, span };
})(window.M);
