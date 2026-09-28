/* iCalendar (RFC 5545) import/export, so your data is never locked in. */
"use strict";
(function (M) {
  const { D } = M;
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const pad = (n) => String(n).padStart(2, "0");

  const escText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const unescText = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

  function fold(line) {
    const out = [];
    let rest = line;
    while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
    out.push(rest);
    return out.join("\r\n");
  }

  const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const icsDateTime = (d) => `${icsDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

  function exportAll(data) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Meridian//Meridian Calendar 1.0//EN",
      "CALSCALE:GREGORIAN", "X-WR-CALNAME:Meridian"];
    const cals = new Map(data.calendars.map((c) => [c.id, c]));
    for (const ev of data.events) {
      const s = D.parse(ev.start), e = D.parse(ev.end);
      lines.push("BEGIN:VEVENT", `UID:${ev.id}@meridian`, `DTSTAMP:${stamp()}`);
      if (ev.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${icsDate(s)}`, `DTEND;VALUE=DATE:${icsDate(e)}`);
      } else {
        lines.push(`DTSTART:${icsDateTime(s)}`, `DTEND:${icsDateTime(e)}`);
      }
      lines.push(`SUMMARY:${escText(ev.title || "Untitled")}`);
      if (ev.location) lines.push(`LOCATION:${escText(ev.location)}`);
      if (ev.notes) lines.push(`DESCRIPTION:${escText(ev.notes)}`);
      const cal = cals.get(ev.calendarId);
      if (cal) lines.push(`CATEGORIES:${escText(cal.name)}`, `X-MERIDIAN-COLOR:${cal.color}`);
      if (ev.recurrence) {
        const r = ev.recurrence;
        let rule = `FREQ=${r.freq.toUpperCase()}`;
        if (r.interval > 1) rule += `;INTERVAL=${r.interval}`;
        if (r.freq === "weekly" && r.byDay && r.byDay.length) rule += `;BYDAY=${r.byDay.map((x) => DAYS[x]).join(",")}`;
        if (r.until) rule += `;UNTIL=${r.until.replace(/-/g, "")}`;
        else if (r.count) rule += `;COUNT=${r.count}`;
        lines.push(`RRULE:${rule}`);
        for (const x of ev.exdates || []) {
          const xd = D.parse(x);
          lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${icsDate(xd)}` : `EXDATE:${icsDateTime(new Date(xd.getFullYear(), xd.getMonth(), xd.getDate(), s.getHours(), s.getMinutes()))}`);
        }
      }
      for (const a of ev.alerts || []) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escText(ev.title || "Reminder")}`,
          a <= 0 ? `TRIGGER:PT${-a}M` : `TRIGGER:-PT${a}M`, "END:VALARM");
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  function parseDate(value, params) {
    const v = value.trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, , z] = m;
    if (h === undefined) return { date: new Date(+y, +mo - 1, +d), allDay: true };
    if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), allDay: false };
    return { date: new Date(+y, +mo - 1, +d, +h, +mi), allDay: false };
  }

  function parseDuration(v) {
    const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return null;
    const [, sign, w, d, h, mi] = m;
    const total = (+w || 0) * 10080 + (+d || 0) * 1440 + (+h || 0) * 60 + (+mi || 0);
    return sign === "-" ? -total : total;
  }

  /** Returns { name, events: [partial events], skipped } */
  function parse(text) {
    const raw = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    const events = [];
    let calName = null, cur = null, inAlarm = false, alarm = null, skipped = 0;
    for (const line of raw) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const head = line.slice(0, idx), value = line.slice(idx + 1);
      const [nameRaw, ...paramParts] = head.split(";");
      const name = nameRaw.toUpperCase();
      const params = Object.fromEntries(paramParts.map((p) => { const [k, v = ""] = p.split("="); return [k.toUpperCase(), v]; }));
      if (name === "X-WR-CALNAME" && !cur) calName = unescText(value);
      if (name === "BEGIN" && value === "VEVENT") { cur = { alerts: [], exdates: [] }; continue; }
      if (!cur) continue;
      if (name === "BEGIN" && value === "VALARM") { inAlarm = true; alarm = {}; continue; }
      if (name === "END" && value === "VALARM") {
        inAlarm = false;
        if (alarm.trigger != null) cur.alerts.push(-alarm.trigger || 0);
        continue;
      }
      if (inAlarm) { if (name === "TRIGGER") alarm.trigger = parseDuration(value); continue; }
      if (name === "END" && value === "VEVENT") {
        const ev = finish(cur);
        if (ev) events.push(ev); else skipped++;
        cur = null;
        continue;
      }
      switch (name) {
        case "SUMMARY": cur.title = unescText(value); break;
        case "LOCATION": cur.location = unescText(value); break;
        case "DESCRIPTION": cur.notes = unescText(value); break;
        case "DTSTART": cur.dtstart = parseDate(value, params); break;
        case "DTEND": cur.dtend = parseDate(value, params); break;
        case "DURATION": cur.duration = parseDuration(value); break;
        case "RRULE": cur.rrule = value; break;
        case "EXDATE": value.split(",").forEach((v) => { const p = parseDate(v, params); if (p) cur.exdates.push(D.ymd(p.date)); }); break;
        case "STATUS": cur.cancelled = value.trim().toUpperCase() === "CANCELLED"; break;
        case "RECURRENCE-ID": cur.isOverride = true; break;
        default: break;
      }
    }
    return { name: calName, events, skipped };
  }

  function finish(c) {
    if (!c.dtstart || c.cancelled) return null;
    const allDay = c.dtstart.allDay;
    const s = c.dtstart.date;
    let e = c.dtend ? c.dtend.date : null;
    if (!e && c.duration != null) e = allDay ? D.addDays(s, Math.max(1, Math.round(c.duration / 1440))) : D.addMinutes(s, c.duration);
    if (!e || e <= s) e = allDay ? D.addDays(s, 1) : D.addMinutes(s, 60);
    const ev = {
      title: c.title || "Untitled", location: c.location || "", notes: c.notes || "",
      allDay, start: allDay ? D.ymd(s) : D.iso(s), end: allDay ? D.ymd(e) : D.iso(e),
      alerts: Array.from(new Set(c.alerts)).slice(0, 2), exdates: c.exdates, recurrence: null,
    };
    if (c.rrule) {
      const r = Object.fromEntries(c.rrule.split(";").map((p) => { const [k, v] = p.split("="); return [k.toUpperCase(), v]; }));
      const freq = (r.FREQ || "").toLowerCase();
      if (["daily", "weekly", "monthly", "yearly"].includes(freq)) {
        ev.recurrence = { freq, interval: +r.INTERVAL || 1, byDay: null, until: null, count: +r.COUNT || null };
        if (freq === "weekly" && r.BYDAY) {
          ev.recurrence.byDay = r.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))).filter((x) => x >= 0);
        }
        if (r.UNTIL) { const u = parseDate(r.UNTIL, {}); if (u) ev.recurrence.until = D.ymd(u.date); }
      }
    }
    return ev;
  }

  M.ICS = { exportAll, parse };
})(window.M);
