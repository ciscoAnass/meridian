// Headless tests for Meridian's calendar logic. Run: node tests/logic.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..", "web", "js");
const ctx = {
  console, Intl, Date, Math, JSON, Set, Map, Array, Object, String, Number, setTimeout, clearTimeout,
  navigator: { language: "en-GB", languages: ["en-GB"] },
  crypto: { randomUUID: () => Math.random().toString(36).slice(2) },
  document: { readyState: "loading", addEventListener() {} },
  matchMedia: () => ({ matches: false }),
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["core.js", "recurrence.js", "store.js", "ics.js", "editor.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const { M } = ctx;
M.settings = { default_alert: 10, week_start: 1 };
M.state = { lastCalendar: null };
M.bridge.call = async () => ({ ok: true });
const { D, R } = M;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } };
// Arrays from the vm realm have a different prototype; compare by value.
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const occ = (ev, a, b) => R.occurrences(ev, D.parse(a), D.parse(b));
const ev = (o) => ({ id: "e1", calendarId: "c", title: "T", allDay: false, exdates: [], alerts: [], recurrence: null, ...o });

console.log("recurrence");
test("single event inside/outside range", () => {
  const e = ev({ start: "2026-09-28T10:00", end: "2026-09-28T11:00" });
  assert.strictEqual(occ(e, "2026-09-28", "2026-09-29").length, 1);
  assert.strictEqual(occ(e, "2026-09-29", "2026-09-30").length, 0);
});
test("weekdays rule skips weekends", () => {
  const e = ev({ start: "2026-09-28T09:30", end: "2026-09-28T09:45", recurrence: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] } });
  const o = occ(e, "2026-09-28", "2026-10-12");
  assert.strictEqual(o.length, 10);
  assert.ok(o.every((x) => x.start.getDay() >= 1 && x.start.getDay() <= 5));
});
test("every 2 weeks", () => {
  const e = ev({ start: "2026-09-28T09:00", end: "2026-09-28T10:00", recurrence: { freq: "weekly", interval: 2, byDay: [1] } });
  eq(occ(e, "2026-09-01", "2026-11-01").map((x) => x.date), ["2026-09-28", "2026-10-12", "2026-10-26"]);
});
test("monthly on the 31st skips short months", () => {
  const e = ev({ start: "2026-01-31T09:00", end: "2026-01-31T10:00", recurrence: { freq: "monthly", interval: 1 } });
  eq(occ(e, "2026-01-01", "2026-06-01").map((x) => x.date), ["2026-01-31", "2026-03-31", "2026-05-31"]);
});
test("yearly on 29 Feb only in leap years", () => {
  const e = ev({ allDay: true, start: "2024-02-29", end: "2024-03-01", recurrence: { freq: "yearly", interval: 1 } });
  eq(occ(e, "2024-01-01", "2029-01-01").map((x) => x.date), ["2024-02-29", "2028-02-29"]);
});
test("count and until are honoured; exdates skip", () => {
  const e = ev({ start: "2026-09-01T08:00", end: "2026-09-01T09:00", recurrence: { freq: "daily", interval: 1, count: 5 }, exdates: ["2026-09-03"] });
  eq(occ(e, "2026-08-01", "2026-10-01").map((x) => x.date), ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05"]);
  const u = ev({ start: "2026-09-01T08:00", end: "2026-09-01T09:00", recurrence: { freq: "daily", interval: 1, until: "2026-09-03" } });
  assert.strictEqual(occ(u, "2026-08-01", "2026-10-01").length, 3);
});
test("multi-day event overlapping range start is included", () => {
  const e = ev({ allDay: true, start: "2026-10-10", end: "2026-10-13" });
  assert.strictEqual(occ(e, "2026-10-12", "2026-10-13").length, 1);
  assert.strictEqual(occ(e, "2026-10-13", "2026-10-14").length, 0); // end is exclusive
});
test("human descriptions", () => {
  const s = D.parse("2026-09-28T09:00");
  assert.strictEqual(R.describe({ freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] }, s), "Every weekday");
  assert.strictEqual(R.describe({ freq: "weekly", interval: 2, byDay: [1] }, s), "Every 2 weeks");
  assert.strictEqual(R.describe({ freq: "daily", interval: 1, count: 3 }, s), "Every day, 3 times");
});

console.log("store");
const fresh = () => {
  M.store.undoStack = []; M.store.redoStack = [];
  M.store.init({ version: 1, calendars: [{ id: "c", name: "P", color: "#000", visible: true }], events: [], meta: {} });
};
test("add, move, undo, redo", () => {
  fresh();
  const e = M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T10:00", end: "2026-09-28T11:00" }));
  const o = M.store.findOcc(`${e.id}@2026-09-28`);
  M.store.moveOcc(o, D.parse("2026-09-29T14:00"), D.parse("2026-09-29T15:00"), "single");
  assert.strictEqual(M.store.event(e.id).start, "2026-09-29T14:00");
  M.store.undo();
  assert.strictEqual(M.store.event(e.id).start, "2026-09-28T10:00");
  M.store.redo();
  assert.strictEqual(M.store.event(e.id).start, "2026-09-29T14:00");
  M.store.undo(); M.store.undo();
  assert.strictEqual(M.store.data.events.length, 0);
});
test("move only this occurrence detaches a copy", () => {
  fresh();
  const e = M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T09:00", end: "2026-09-28T10:00", recurrence: { freq: "daily", interval: 1 } }));
  const o = M.store.findOcc(`${e.id}@2026-09-30`);
  const id = M.store.moveOcc(o, D.parse("2026-09-30T15:00"), D.parse("2026-09-30T16:00"), "this");
  assert.notStrictEqual(id, e.id);
  eq(M.store.event(e.id).exdates, ["2026-09-30"]);
  const day = M.store.range(D.parse("2026-09-30"), D.parse("2026-10-01"));
  assert.strictEqual(day.length, 1);
  assert.strictEqual(D.iso(day[0].start), "2026-09-30T15:00");
});
test("move all future splits the series", () => {
  fresh();
  const e = M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T09:00", end: "2026-09-28T10:00", recurrence: { freq: "daily", interval: 1 } }));
  const o = M.store.findOcc(`${e.id}@2026-10-01`);
  M.store.moveOcc(o, D.parse("2026-10-01T11:00"), D.parse("2026-10-01T12:00"), "future");
  const list = M.store.range(D.parse("2026-09-28"), D.parse("2026-10-04")).map((x) => D.iso(x.start));
  eq(list, ["2026-09-28T09:00", "2026-09-29T09:00", "2026-09-30T09:00", "2026-10-01T11:00", "2026-10-02T11:00", "2026-10-03T11:00"]);
});
test("delete this / future / all", () => {
  fresh();
  const e = M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T09:00", end: "2026-09-28T10:00", recurrence: { freq: "daily", interval: 1 } }));
  const count = () => M.store.range(D.parse("2026-09-28"), D.parse("2026-10-05")).length;
  M.store.deleteOcc(M.store.findOcc(`${e.id}@2026-09-29`), "this");
  assert.strictEqual(count(), 6);
  M.store.deleteOcc(M.store.findOcc(`${e.id}@2026-10-02`), "future");
  assert.strictEqual(count(), 3);
  M.store.deleteOcc(M.store.findOcc(`${e.id}@2026-09-28`), "future");
  assert.strictEqual(M.store.data.events.length, 0);
});
test("hidden calendars are excluded from views", () => {
  fresh();
  M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T09:00", end: "2026-09-28T10:00" }));
  M.store.toggleCalendar("c");
  assert.strictEqual(M.store.range(D.parse("2026-09-28"), D.parse("2026-09-29")).length, 0);
  assert.strictEqual(M.store.range(D.parse("2026-09-28"), D.parse("2026-09-29"), { includeHidden: true }).length, 1);
});
test("takePending returns unsaved data once", () => {
  fresh();
  M.store.addEvent(M.store.newEvent({ calendarId: "c", start: "2026-09-28T09:00", end: "2026-09-28T10:00" }));
  assert.ok(M.store.takePending());
  assert.strictEqual(M.store.takePending(), null);
});

console.log("ics");
test("export → import round trip", () => {
  fresh();
  M.store.addEvent(M.store.newEvent({ calendarId: "c", title: "Standup; daily, quick", notes: "Line 1\nLine 2", start: "2026-09-28T09:30", end: "2026-09-28T09:45", recurrence: { freq: "weekly", interval: 1, byDay: [1, 3], until: "2026-12-31" }, exdates: ["2026-09-30"], alerts: [10] }));
  M.store.addEvent(M.store.newEvent({ calendarId: "c", title: "Trip", allDay: true, start: "2026-10-10", end: "2026-10-13", alerts: [-540] }));
  const text = M.ICS.exportAll(M.store.data);
  assert.ok(text.split("\r\n").every((l) => l.length <= 75), "lines folded");
  const back = M.ICS.parse(text);
  assert.strictEqual(back.events.length, 2);
  const [a, b] = back.events;
  assert.strictEqual(a.title, "Standup; daily, quick");
  assert.strictEqual(a.notes, "Line 1\nLine 2");
  eq(a.recurrence.byDay, [1, 3]);
  assert.strictEqual(a.recurrence.until, "2026-12-31");
  eq(a.exdates, ["2026-09-30"]);
  eq(a.alerts, [10]);
  assert.strictEqual(b.allDay, true);
  assert.strictEqual(b.end, "2026-10-13");
  eq(b.alerts, [-540]);
});
test("imports UTC times and DURATION", () => {
  const txt = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260928T080000Z\r\nDURATION:PT1H30M\r\nSUMMARY:UTC\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20260928T080000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const r = M.ICS.parse(txt);
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.skipped, 1);
  const s = D.parse(r.events[0].start), e = D.parse(r.events[0].end);
  assert.strictEqual((e - s) / 60000, 90);
  assert.strictEqual(s.getTime(), Date.UTC(2026, 8, 28, 8, 0));
});

console.log("time entry");
test("parses the ways people type times", () => {
  const p = M.parseTime;
  eq([p("9"), p("09"), p("930"), p("9:30"), p("9.30"), p("21"), p("2115"), p("9pm"), p("9:30 PM"), p("12am"), p("12pm")],
     [540, 540, 570, 570, 570, 1260, 1275, 1260, 1290, 0, 720]);
  eq([p("25"), p("9:75"), p("13pm"), p("abc")], [null, null, null, null]);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
