/* Store: the single source of truth, with autosave and undo/redo. */
"use strict";
(function (M) {
  const { D } = M;

  M.PALETTE = [
    { name: "Coral", hex: "#F0604D" },
    { name: "Tangerine", hex: "#F29B38" },
    { name: "Sunflower", hex: "#E8C12E" },
    { name: "Fern", hex: "#3DB36B" },
    { name: "Lagoon", hex: "#1FA9B8" },
    { name: "Cobalt", hex: "#3F7BF0" },
    { name: "Iris", hex: "#7466F0" },
    { name: "Orchid", hex: "#C25BD9" },
    { name: "Rose", hex: "#EC5B8F" },
    { name: "Slate", hex: "#8A8F9C" },
  ];

  const VERSION = 1;
  const freshData = () => ({
    version: VERSION,
    calendars: [
      { id: M.uid(), name: "Personal", color: "#3F7BF0", visible: true },
      { id: M.uid(), name: "Work", color: "#F0604D", visible: true },
    ],
    events: [],
    meta: { lastReminderCheck: null },
  });

  const store = {
    data: null,
    undoStack: [],
    redoStack: [],
    dirty: false,
    _listeners: [],
    _saveTimer: null,
    _cache: new Map(),

    init(data) {
      this.data = data && data.calendars ? data : freshData();
      this.data.meta = this.data.meta || {};
      if (!this.data.calendars.length) this.data.calendars = freshData().calendars;
      if (!data) this.scheduleSave();
    },

    onChange(fn) { this._listeners.push(fn); },
    _emit(reason) { this._cache.clear(); this._listeners.forEach((fn) => fn(reason)); },

    // ----------------------------------------------------------- persistence
    scheduleSave() {
      this.dirty = true;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.flush(), 350);
    },
    async flush() {
      clearTimeout(this._saveTimer);
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const res = await M.bridge.call("save", { data: this.data });
        if (res && res.error) throw new Error(res.error);
      } catch (e) {
        this.dirty = true;
        M.toast && M.toast("Couldn’t save changes. Retrying…");
        this._saveTimer = setTimeout(() => this.flush(), 3000);
      }
    },
    /** Used by the native side on quit: returns unsaved JSON, or null. */
    takePending() {
      if (!this.dirty) return null;
      clearTimeout(this._saveTimer);
      this.dirty = false;
      return JSON.stringify(this.data);
    },

    // --------------------------------------------------------------- history
    snapshot() { return JSON.stringify({ calendars: this.data.calendars, events: this.data.events }); },
    checkpoint() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    },
    _restore(snap) {
      const s = JSON.parse(snap);
      this.data.calendars = s.calendars;
      this.data.events = s.events;
      this.scheduleSave();
      this._emit("history");
    },
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.snapshot());
      this._restore(this.undoStack.pop());
      return true;
    },
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.snapshot());
      this._restore(this.redoStack.pop());
      return true;
    },
    /** Mutate with an undo checkpoint. */
    commit(fn, reason = "edit") {
      this.checkpoint();
      fn(this.data);
      this.scheduleSave();
      this._emit(reason);
    },
    /** Mutate without a new checkpoint (live edits inside an open editor). */
    touch(fn, reason = "edit") {
      fn(this.data);
      this.scheduleSave();
      this._emit(reason);
    },

    // --------------------------------------------------------------- queries
    calendar(id) { return this.data.calendars.find((c) => c.id === id) || this.data.calendars[0]; },
    event(id) { return this.data.events.find((e) => e.id === id); },
    visibleIds() { return new Set(this.data.calendars.filter((c) => c.visible).map((c) => c.id)); },

    /** Occurrences of visible events overlapping [from, to), sorted. */
    range(from, to, { includeHidden = false } = {}) {
      const key = `${from.getTime()}-${to.getTime()}-${includeHidden}`;
      if (this._cache.has(key)) return this._cache.get(key);
      const vis = this.visibleIds();
      const out = [];
      for (const ev of this.data.events) {
        if (!includeHidden && !vis.has(ev.calendarId)) continue;
        for (const o of M.R.occurrences(ev, from, to)) out.push(o);
      }
      out.sort((a, b) => (a.start - b.start) || (Number(b.ev.allDay) - Number(a.ev.allDay)) || ((b.end - b.start) - (a.end - a.start)) || a.ev.title.localeCompare(b.ev.title));
      if (this._cache.size > 120) this._cache.clear(); // reminders/clock query new ranges constantly
      this._cache.set(key, out);
      return out;
    },
    findOcc(key) {
      const [id, date] = key.split("@");
      const ev = this.event(id);
      if (!ev) return null;
      const day = D.parse(date);
      return M.R.occurrences(ev, D.addDays(day, -1), D.addDays(day, 2)).find((o) => o.key === key)
        || M.R.occurrences(ev, D.addDays(day, -60), D.addDays(day, 60)).find((o) => o.date === date) || null;
    },

    // ------------------------------------------------------------ mutations
    newEvent(fields) {
      const now = new Date().toISOString();
      const alert = M.settings.default_alert;
      return {
        id: M.uid(),
        calendarId: fields.calendarId || M.state.lastCalendar || this.data.calendars[0].id,
        title: "", location: "", notes: "",
        allDay: false, start: null, end: null,
        recurrence: null, exdates: [],
        alerts: alert !== undefined && alert >= 0 ? [alert] : [],
        created: now, updated: now,
        ...fields,
      };
    },
    addEvent(ev) { this.commit((d) => d.events.push(ev), "add"); return ev; },

    /** Replace occurrence `occ` of a recurring event with a standalone copy carrying `changes`. */
    detach(d, occ, changes) {
      const master = d.events.find((e) => e.id === occ.ev.id);
      master.exdates = Array.from(new Set([...(master.exdates || []), occ.date]));
      const copy = {
        ...JSON.parse(JSON.stringify(master)),
        id: M.uid(), recurrence: null, exdates: [],
        start: master.allDay ? D.ymd(occ.start) : D.iso(occ.start),
        end: master.allDay ? D.ymd(occ.end) : D.iso(occ.end),
        updated: new Date().toISOString(),
        ...changes,
      };
      d.events.push(copy);
      return copy;
    },

    /** Split so the series continues from `occ` as a new event with `changes`. */
    splitFuture(d, occ, changes) {
      const master = d.events.find((e) => e.id === occ.ev.id);
      const first = D.parse(master.start);
      if (D.sameDay(first, occ.start)) {
        Object.assign(master, changes, { updated: new Date().toISOString() });
        return master;
      }
      const tail = {
        ...JSON.parse(JSON.stringify(master)),
        id: M.uid(),
        start: master.allDay ? D.ymd(occ.start) : D.iso(occ.start),
        end: master.allDay ? D.ymd(occ.end) : D.iso(occ.end),
        exdates: (master.exdates || []).filter((x) => x > occ.date),
        updated: new Date().toISOString(),
      };
      if (tail.recurrence && tail.recurrence.count) {
        const done = M.R.occurrences(master, first, occ.start).length;
        tail.recurrence.count = Math.max(1, tail.recurrence.count - done);
      }
      master.recurrence = { ...master.recurrence, until: D.ymd(D.addDays(occ.start, -1)), count: null };
      Object.assign(tail, changes);
      d.events.push(tail);
      return tail;
    },

    /**
     * Move/resize an occurrence to [start, end).
     * scope: "single" (non-recurring or detach), "this", "future".
     */
    moveOcc(occ, start, end, scope) {
      const ev = occ.ev;
      const fmt = (x) => (ev.allDay ? D.ymd(x) : D.iso(x));
      let resultId = ev.id;
      this.commit((d) => {
        const target = d.events.find((e) => e.id === ev.id);
        if (!ev.recurrence) {
          target.start = fmt(start); target.end = fmt(end); target.updated = new Date().toISOString();
        } else if (scope === "this") {
          resultId = this.detach(d, occ, { start: fmt(start), end: fmt(end) }).id;
        } else {
          // Shift the whole (future) series by the same delta.
          const delta = start - occ.start;
          const dur = end - start;
          const tail = this.splitFuture(d, occ, {});
          resultId = tail.id;
          const s = new Date(D.parse(tail.start).getTime() + delta);
          const newStart = ev.allDay ? D.addDays(D.parse(tail.start), Math.round(delta / D.DAY)) : s;
          tail.start = fmt(newStart);
          tail.end = fmt(ev.allDay ? D.addDays(newStart, Math.round(dur / D.DAY)) : new Date(newStart.getTime() + dur));
          if (tail.recurrence && tail.recurrence.freq === "weekly" && tail.recurrence.byDay) {
            const shift = D.dayDiff(occ.start, start);
            tail.recurrence.byDay = tail.recurrence.byDay.map((x) => (((x + shift) % 7) + 7) % 7);
          }
        }
      }, "move");
      return resultId;
    },

    deleteOcc(occ, scope) {
      this.commit((d) => {
        const ev = d.events.find((e) => e.id === occ.ev.id);
        if (!ev) return;
        if (!ev.recurrence || scope === "all") {
          d.events = d.events.filter((e) => e.id !== ev.id);
        } else if (scope === "this") {
          ev.exdates = Array.from(new Set([...(ev.exdates || []), occ.date]));
        } else if (scope === "future") {
          if (D.sameDay(D.parse(ev.start), occ.start)) d.events = d.events.filter((e) => e.id !== ev.id);
          else ev.recurrence = { ...ev.recurrence, until: D.ymd(D.addDays(occ.start, -1)), count: null };
        }
      }, "delete");
    },

    // ------------------------------------------------------------ calendars
    addCalendar(name, color) {
      const cal = { id: M.uid(), name, color, visible: true };
      this.commit((d) => d.calendars.push(cal), "calendar");
      return cal;
    },
    updateCalendar(id, changes) {
      this.commit((d) => Object.assign(d.calendars.find((c) => c.id === id), changes), "calendar");
    },
    toggleCalendar(id) {
      // Visibility is a view preference, not an edit: no undo entry.
      this.touch((d) => { const c = d.calendars.find((x) => x.id === id); c.visible = !c.visible; }, "visibility");
    },
    deleteCalendar(id) {
      this.commit((d) => {
        d.calendars = d.calendars.filter((c) => c.id !== id);
        d.events = d.events.filter((e) => e.calendarId !== id);
      }, "calendar");
    },
  };

  M.store = store;
})(window.M);
