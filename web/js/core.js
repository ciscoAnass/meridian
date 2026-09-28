/* Meridian core: namespace, date math, formatting, DOM helpers, native bridge. */
"use strict";
window.M = window.M || {};

(function (M) {
  // ---------------------------------------------------------------- dates
  const pad = (n) => String(n).padStart(2, "0");
  const D = {
    MIN: 60000,
    DAY: 86400000,
    ymd: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    iso: (d) => `${D.ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    parse(s) {
      if (!s) return null;
      const [date, time] = s.split("T");
      const [y, m, d] = date.split("-").map(Number);
      if (!time) return new Date(y, m - 1, d);
      const [h, mi] = time.split(":").map(Number);
      return new Date(y, m - 1, d, h, mi || 0);
    },
    startOfDay: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    addDays: (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()),
    addMonths(d, n) {
      const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
      const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
      return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
    },
    addMinutes: (d, n) => new Date(d.getTime() + n * 60000),
    sameDay: (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),
    dayDiff: (a, b) => Math.round((D.startOfDay(b) - D.startOfDay(a)) / 86400000),
    minutesOfDay: (d) => d.getHours() * 60 + d.getMinutes(),
    startOfWeek(d, weekStart) {
      const s = D.startOfDay(d);
      const diff = (s.getDay() - weekStart + 7) % 7;
      return D.addDays(s, -diff);
    },
    startOfMonth: (d) => new Date(d.getFullYear(), d.getMonth(), 1),
    isoWeek(d) {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - day);
      const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      return Math.ceil(((t - y0) / 86400000 + 1) / 7);
    },
    snap: (min, step = 15) => Math.round(min / step) * step,
    today: () => D.startOfDay(new Date()),
  };
  M.D = D;

  // ----------------------------------------------------------- formatting
  const cache = new Map();
  const fmtr = (opts) => {
    const key = M.locale + JSON.stringify(opts);
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(M.locale, opts));
    return cache.get(key);
  };
  M.locale = (function () {
    // navigator.language can be "c", "posix" or empty on minimal systems.
    const wanted = [navigator.language, ...(navigator.languages || []), "en-GB"];
    for (const tag of wanted) {
      try {
        if (tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length) return tag;
      } catch (_) { /* invalid tag */ }
    }
    return "en-GB";
  })();

  M.F = {
    hour12: false,
    detect() {
      const s = M.settings || {};
      if (s.time_format === 12) this.hour12 = true;
      else if (s.time_format === 24) this.hour12 = false;
      else this.hour12 = fmtr({ hour: "numeric" }).resolvedOptions().hourCycle?.startsWith("h1") || false;
      cache.clear();
    },
    time(d) {
      if (this.hour12) {
        let h = d.getHours() % 12 || 12;
        const m = d.getMinutes();
        return `${h}${m ? ":" + pad(m) : ""}${d.getHours() < 12 ? "am" : "pm"}`;
      }
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    hourLabel(h) {
      if (this.hour12) return h === 0 ? "12 am" : h === 12 ? "Noon" : `${h % 12} ${h < 12 ? "am" : "pm"}`;
      return `${pad(h)}:00`;
    },
    range(a, b) { return `${this.time(a)} – ${this.time(b)}`; },
    month: (d) => fmtr({ month: "long" }).format(d),
    monthShort: (d) => fmtr({ month: "short" }).format(d),
    weekday: (d) => fmtr({ weekday: "long" }).format(d),
    weekdayShort: (d) => fmtr({ weekday: "short" }).format(d),
    weekdayNarrow: (d) => fmtr({ weekday: "narrow" }).format(d),
    dayMonth: (d) => fmtr({ day: "numeric", month: "long" }).format(d),
    dayMonthShort: (d) => fmtr({ day: "numeric", month: "short" }).format(d),
    full: (d) => fmtr({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d),
    fieldDate: (d) => fmtr({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d),
    relativeDay(d) {
      const diff = D.dayDiff(D.today(), d);
      if (diff === 0) return "Today";
      if (diff === 1) return "Tomorrow";
      if (diff === -1) return "Yesterday";
      if (diff > 1 && diff < 7) return M.F.weekday(d);
      return fmtr({ weekday: "short", day: "numeric", month: "short",
        year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(d);
    },
    duration(min) {
      if (min < 60) return `${min} min`;
      const h = Math.floor(min / 60), m = min % 60;
      return m ? `${h} h ${m} min` : `${h} h`;
    },
  };

  M.weekStart = function () {
    const s = M.settings && M.settings.week_start;
    if (s !== undefined && s !== "auto") return Number(s);
    try {
      const loc = new Intl.Locale(M.locale);
      const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay % 7;
    } catch (_) { /* fall through */ }
    return /^(en-US|en-CA|ja|he|pt-BR|ko|zh-TW|en-PH)/.test(M.locale) ? 0 : 1;
  };

  // ------------------------------------------------------------------ DOM
  M.$ = (sel, root = document) => root.querySelector(sel);
  M.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  M.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  M.h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  M.uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  M.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  M.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  M.reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  M.norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  M.icon = {
    chevL: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
    chevR: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    repeat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7V6a2 2 0 0 1 2-2h7m-2-2 2 2-2 2M13 9v1a2 2 0 0 1-2 2H4m2 2-2-2 2-2"/></svg>',
    bell: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11Zm2.5 2.5a1.5 1.5 0 0 0 3 0"/></svg>',
    pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z"/><circle cx="8" cy="6.5" r="1.5"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
    more: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12.5" cy="8" r="1"/></svg>',
    note: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4h9M3.5 8h9M3.5 12h5"/></svg>',
    clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>',
  };

  // --------------------------------------------------------------- bridge
  // Native: WebKit script message handler with replies (see window.py).
  // Browser (development): a localStorage-backed stand-in.
  const native = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.meridian);
  const listeners = {};
  if (native) {
    const report = (msg) => { try { window.webkit.messageHandlers.meridian.postMessage(JSON.stringify({ cmd: "log", args: { msg: String(msg) } })); } catch (_) { /* ignore */ } };
    window.addEventListener("error", (e) => report(`${e.message} at ${e.filename}:${e.lineno}`));
    window.addEventListener("unhandledrejection", (e) => report(`Unhandled: ${e.reason && (e.reason.stack || e.reason)}`));
  }
  M.bridge = {
    native,
    async call(cmd, args = {}) {
      if (native) {
        const raw = await window.webkit.messageHandlers.meridian.postMessage(JSON.stringify({ cmd, args }));
        return JSON.parse(raw);
      }
      return devBridge(cmd, args);
    },
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    receive(name, payload) { (listeners[name] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); },
  };

  function devBridge(cmd, args) {
    const ls = (() => { try { return window.localStorage; } catch (_) { return null; } })();
    switch (cmd) {
      case "load": return {
        data: JSON.parse((ls && ls.getItem("meridian-data")) || "null"),
        settings: JSON.parse((ls && ls.getItem("meridian-settings")) || "{}"),
        dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      };
      case "save": ls && ls.setItem("meridian-data", JSON.stringify(args.data)); return { ok: true };
      case "notify":
        if ("Notification" in window && Notification.permission === "granted") new Notification(args.title, { body: args.body });
        return { ok: true };
      case "export": {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([args.text], { type: "text/calendar" }));
        a.download = args.filename; a.click();
        return { ok: true };
      }
      default: return { ok: true };
    }
  }
})(window.M);
