"""The main window.

The window chrome (header bar, window controls, view switcher, search,
menus, dialogs) is native GTK4/libadwaita. The calendar surface itself is
drawn by the system WebKitGTK engine from local files only. The two halves
talk over a tiny JSON bridge.
"""

import json
import os

from gi.repository import Adw, Gdk, Gio, GLib, GObject, Gtk, JavaScriptCore, WebKit

from . import APP_NAME

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
ICON_DIR = os.path.join(ROOT, "data", "icons", "hicolor")

VIEWS = [("day", "Day"), ("week", "Week"), ("month", "Month"), ("agenda", "Agenda")]

# Header colours must match the web surface exactly so the window reads as
# one continuous sheet.
PALETTE = {
    False: {"chrome": "#F4F4F6", "canvas": "#FFFFFF", "line": "rgba(24,24,40,0.09)",
            "seg": "rgba(24,24,40,0.06)", "pill": "#FFFFFF",
            "hover": "rgba(24,24,40,0.06)", "press": "rgba(24,24,40,0.10)"},
    True: {"chrome": "#1F1F23", "canvas": "#17171A", "line": "rgba(255,255,255,0.07)",
           "seg": "rgba(255,255,255,0.07)", "pill": "#4A4A52",
           "hover": "rgba(255,255,255,0.07)", "press": "rgba(255,255,255,0.12)"},
}

HEADER_CSS = """
headerbar.meridian-header {{
  background: {chrome};
  box-shadow: inset 0 -1px {line};
  min-height: 50px;
}}
window.meridian, window.meridian > * {{ background: {canvas}; }}
.meridian-switcher {{
  background: {seg};
  border-radius: 9px;
  padding: 2px;
}}
.meridian-switcher > button {{
  min-width: 68px; min-height: 26px; padding: 0 10px;
  font-weight: 500; border-radius: 7px;
  background: none; box-shadow: none;
  transition: background 160ms ease, box-shadow 160ms ease;
}}
.meridian-switcher > button:hover:not(:checked) {{ background: {hover}; }}
.meridian-switcher > button:checked {{
  background: {pill};
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07);
}}
headerbar.meridian-header button.flat-ish {{ background: none; box-shadow: none; }}
headerbar.meridian-header button.flat-ish:hover {{ background: {hover}; }}
headerbar.meridian-header button.flat-ish:active,
headerbar.meridian-header button.flat-ish:checked {{ background: {press}; }}
.meridian-today {{ font-weight: 600; padding-left: 12px; padding-right: 12px; }}
.meridian-search {{ min-width: 220px; }}
"""


class MeridianWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title=APP_NAME)
        self.app = app
        self.add_css_class("meridian")
        self._syncing = False
        self._ready = False
        self._queued = []

        geo = app.settings["window"]
        self.set_default_size(int(geo.get("width", 1180)), int(geo.get("height", 780)))
        if geo.get("maximized"):
            self.maximize()
        self.set_size_request(380, 520)
        self.set_hide_on_close(bool(app.settings.get("run_in_background")))

        self._css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), self._css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        style = Adw.StyleManager.get_default()
        style.connect("notify::dark", self._on_dark_changed)

        self.webview = self._build_webview()
        header = self._build_header()
        self.search_bar = self._build_search_bar()

        toolbar = Adw.ToolbarView()
        toolbar.add_top_bar(header)
        toolbar.add_top_bar(self.search_bar)
        toolbar.set_content(self.webview)
        self.set_content(toolbar)
        self._build_breakpoints()
        self._apply_palette()

        self.connect("close-request", self._on_close_request)
        self.webview.load_uri(GLib.filename_to_uri(os.path.join(WEB_DIR, "index.html"), None))

    # ------------------------------------------------------------------
    # Header bar
    # ------------------------------------------------------------------
    def _build_header(self):
        header = Adw.HeaderBar()
        header.add_css_class("meridian-header")

        self.sidebar_btn = Gtk.ToggleButton(tooltip_text="Show sidebar (Ctrl+B)")
        self.sidebar_btn.set_child(_bundled_icon("meridian-sidebar-symbolic"))
        self.sidebar_btn.add_css_class("flat-ish")
        self.sidebar_btn.set_active(bool(self.app.settings.get("sidebar", True)))
        self.sidebar_btn.connect("toggled", self._on_sidebar_toggled)
        header.pack_start(self.sidebar_btn)

        today = Gtk.Button(label="Today", tooltip_text="Go to today (T)")
        today.add_css_class("meridian-today")
        today.add_css_class("flat-ish")
        today.connect("clicked", lambda *_: self._emit_and_focus("today", {}))
        header.pack_start(today)

        nav = Gtk.Box(spacing=2)
        for icon, direction, tip in [("go-previous-symbolic", -1, "Previous (←)"),
                                     ("go-next-symbolic", 1, "Next (→)")]:
            btn = Gtk.Button(icon_name=icon, tooltip_text=tip, css_classes=["flat-ish"])
            btn.connect("clicked", lambda _b, d=direction: self._emit_and_focus("nav", {"dir": d}))
            nav.append(btn)
        header.pack_start(nav)

        # Wide layout: segmented switcher. Narrow layout: compact dropdown.
        self.switcher = Gtk.Box(spacing=2, css_classes=["meridian-switcher"])
        self.view_buttons = {}
        group = None
        for key, label in VIEWS:
            btn = Gtk.ToggleButton(label=label)
            if group:
                btn.set_group(group)
            group = group or btn
            btn.connect("toggled", self._on_view_toggled, key)
            self.switcher.append(btn)
            self.view_buttons[key] = btn
        self.view_dropdown = Gtk.DropDown.new_from_strings([label for _k, label in VIEWS])
        self.view_dropdown.set_visible(False)
        self.view_dropdown.connect("notify::selected", self._on_view_dropdown)
        title = Gtk.Box()
        title.append(self.switcher)
        title.append(self.view_dropdown)
        header.set_title_widget(title)

        menu = Gio.Menu()
        section = Gio.Menu()
        section.append("Import Calendar…", "app.import")
        section.append("Export Calendar…", "app.export")
        menu.append_section(None, section)
        section = Gio.Menu()
        section.append("Preferences", "app.preferences")
        section.append("Keyboard Shortcuts", "app.shortcuts")
        section.append(f"About {APP_NAME}", "app.about")
        menu.append_section(None, section)
        section = Gio.Menu()
        section.append("Quit", "app.quit")
        menu.append_section(None, section)
        menu_btn = Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu,
                                  tooltip_text="Main menu", primary=True)
        menu_btn.add_css_class("flat")
        header.pack_end(menu_btn)

        add = Gtk.Button(icon_name="list-add-symbolic", tooltip_text="New event (N)", css_classes=["flat-ish"])
        add.connect("clicked", lambda *_: self._emit_and_focus("new", {}))
        header.pack_end(add)

        self.search_entry = Gtk.SearchEntry(placeholder_text="Search events")
        self.search_entry.add_css_class("meridian-search")
        self._wire_search(self.search_entry)
        header.pack_end(self.search_entry)

        self.search_btn = Gtk.ToggleButton(icon_name="system-search-symbolic",
                                           tooltip_text="Search (Ctrl+F)", visible=False)
        header.pack_end(self.search_btn)
        return header

    def _build_search_bar(self):
        bar = Gtk.SearchBar()
        self.narrow_entry = Gtk.SearchEntry(placeholder_text="Search events", hexpand=True)
        self._wire_search(self.narrow_entry)
        clamp = Adw.Clamp(maximum_size=520, child=self.narrow_entry)
        bar.set_child(clamp)
        bar.connect_entry(self.narrow_entry)
        self.search_btn.bind_property("active", bar, "search-mode-enabled",
                                      GObject.BindingFlags.BIDIRECTIONAL)
        return bar

    def _wire_search(self, entry):
        entry.connect("search-changed", lambda e: self.emit_js("search", {"q": e.get_text()}))
        entry.connect("activate", lambda e: self.emit_js("search-activate", {}))
        entry.connect("stop-search", self._on_stop_search)
        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", self._on_search_key)
        entry.add_controller(keys)

    def _on_search_key(self, _ctl, keyval, _code, _state):
        if keyval in (Gdk.KEY_Down, Gdk.KEY_Tab):
            self.emit_js("focus-results", {})
            self.webview.grab_focus()
            return True
        return False

    def _on_stop_search(self, entry):
        entry.set_text("")
        self.search_btn.set_active(False)
        self.webview.grab_focus()

    def _build_breakpoints(self):
        compact = Adw.Breakpoint.new(Adw.BreakpointCondition.parse("max-width: 1060sp"))
        compact.add_setter(self.search_entry, "visible", False)
        compact.add_setter(self.search_btn, "visible", True)
        self.add_breakpoint(compact)
        narrow = Adw.Breakpoint.new(Adw.BreakpointCondition.parse("max-width: 600sp"))
        narrow.add_setter(self.search_entry, "visible", False)
        narrow.add_setter(self.search_btn, "visible", True)
        narrow.add_setter(self.switcher, "visible", False)
        narrow.add_setter(self.view_dropdown, "visible", True)
        self.add_breakpoint(narrow)

    def _on_sidebar_toggled(self, btn):
        if self._syncing:
            return
        self.emit_js("sidebar", {"visible": btn.get_active()})
        self.webview.grab_focus()

    def _on_view_toggled(self, btn, key):
        if self._syncing or not btn.get_active():
            return
        self._emit_and_focus("view", {"view": key})

    def _on_view_dropdown(self, dd, _p):
        if self._syncing:
            return
        self._emit_and_focus("view", {"view": VIEWS[dd.get_selected()][0]})

    def _emit_and_focus(self, name, payload):
        self.emit_js(name, payload)
        self.webview.grab_focus()

    def sync_state(self, view=None, title=None, sidebar=None):
        self._syncing = True
        try:
            if view in self.view_buttons:
                self.view_buttons[view].set_active(True)
                self.view_dropdown.set_selected([k for k, _ in VIEWS].index(view))
            if sidebar is not None:
                self.sidebar_btn.set_active(bool(sidebar))
        finally:
            self._syncing = False
        if title:
            self.set_title(f"{title} – {APP_NAME}")

    # ------------------------------------------------------------------
    # Web view
    # ------------------------------------------------------------------
    def _build_webview(self):
        ucm = WebKit.UserContentManager()
        ucm.register_script_message_handler_with_reply("meridian", None)
        ucm.connect("script-message-with-reply-received::meridian", self._on_script_message)

        # Ephemeral session: no disk cache, cookies or local storage.
        session = WebKit.NetworkSession.new_ephemeral()
        view = WebKit.WebView(user_content_manager=ucm, network_session=session)
        view.set_vexpand(True)
        view.set_hexpand(True)

        s = view.get_settings()
        s.set_enable_developer_extras(self.app.debug)
        s.set_enable_write_console_messages_to_stdout(self.app.debug)
        s.set_allow_file_access_from_file_urls(True)
        s.set_allow_universal_access_from_file_urls(False)
        s.set_javascript_can_open_windows_automatically(False)
        s.set_enable_back_forward_navigation_gestures(False)
        s.set_enable_smooth_scrolling(True)
        s.set_enable_webgl(False)
        s.set_enable_webaudio(False)
        s.set_enable_media(False)
        s.set_media_playback_requires_user_gesture(True)
        s.set_enable_page_cache(False)
        s.set_user_agent_with_application_details(APP_NAME, "1")

        view.connect("decide-policy", self._on_decide_policy)
        view.connect("context-menu", self._on_context_menu)
        view.connect("web-process-terminated", lambda v, _r: v.reload())
        view.connect("permission-request", lambda _v, req: (req.deny(), True)[1])
        return view

    def _on_decide_policy(self, _view, decision, kind):
        if kind in (WebKit.PolicyDecisionType.NAVIGATION_ACTION,
                    WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri() or ""
            web_root = GLib.filename_to_uri(WEB_DIR, None)
            if uri.startswith(web_root) and kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION:
                decision.use()
                return True
            decision.ignore()
            if uri.startswith(("https://", "http://", "mailto:")):
                Gtk.UriLauncher.new(uri).launch(self, None, None)
            return True
        return False

    def _on_context_menu(self, _view, _menu, hit):
        # Keep copy/paste inside text fields; hide "Reload" and friends elsewhere.
        if self.app.debug:
            return False
        return not hit.context_is_editable()

    def _on_dark_changed(self, *_):
        self._apply_palette()
        self.emit_js("theme", {"dark": Adw.StyleManager.get_default().get_dark()})

    def _apply_palette(self):
        dark = Adw.StyleManager.get_default().get_dark()
        colors = PALETTE[dark]
        self._css.load_from_string(HEADER_CSS.format(**colors))
        rgba = Gdk.RGBA()
        rgba.parse(colors["canvas"])
        self.webview.set_background_color(rgba)

    # ------------------------------------------------------------------
    # Bridge
    # ------------------------------------------------------------------
    def emit_js(self, name, payload):
        script = f"window.M&&M.bridge&&M.bridge.receive({json.dumps(name)},{json.dumps(payload)})"
        if not self._ready and name not in ("theme",):
            self._queued.append(script)
            return
        self.webview.evaluate_javascript(script, -1, None, None, None, None, None)

    def _on_script_message(self, _manager, value, reply):
        try:
            message = json.loads(value.to_string())
            cmd = message.get("cmd", "")
            args = message.get("args") or {}
        except (ValueError, AttributeError):
            self._reply(reply, value, {"error": "bad message"})
            return True
        handler = getattr(self, f"cmd_{cmd}", None)
        if handler is None:
            self._reply(reply, value, {"error": f"unknown command {cmd}"})
            return True
        ctx = value.get_context()
        try:
            result = handler(lambda r: self._reply_ctx(reply, ctx, r), **args)
        except Exception as exc:  # never let a bad message crash the app
            print(f"meridian: bridge command {cmd} failed: {exc}")
            self._reply(reply, value, {"error": str(exc)})
            return True
        if result is not NotImplemented:
            self._reply(reply, value, result)
        return True

    def _reply(self, reply, value, result):
        self._reply_ctx(reply, value.get_context(), result)

    @staticmethod
    def _reply_ctx(reply, ctx, result):
        reply.return_value(JavaScriptCore.Value.new_string(ctx, json.dumps(result)))

    # Each command receives `done` for async replies; returning
    # NotImplemented means "I'll call done() later".
    def cmd_load(self, _done):
        return {
            "data": self.app.data_store.load(),
            "settings": self.app.settings,
            "dark": Adw.StyleManager.get_default().get_dark(),
        }

    def cmd_ready(self, _done):
        """The page has booted and rendered: deliver anything queued meanwhile."""
        self._ready = True
        GLib.idle_add(self._drain_queue)
        return {"ok": True}

    def _drain_queue(self):
        queued, self._queued = self._queued, []
        for script in queued:
            self.webview.evaluate_javascript(script, -1, None, None, None, None, None)
        test = os.environ.get("MERIDIAN_EVAL") if self.app.debug else None
        if test:  # development/testing hook only, never active in normal use
            GLib.timeout_add(2500, lambda: self.webview.evaluate_javascript(
                test, -1, None, None, None, None, None) and False)
        return False

    def cmd_log(self, _done, msg=""):
        print(f"meridian[web]: {msg}", flush=True)
        return {"ok": True}

    def cmd_save(self, _done, data):
        self.app.data_store.save(data)
        return {"ok": True}

    def cmd_notify(self, _done, key, title, body=""):
        self.app.send_reminder(key, title, body)
        return {"ok": True}

    def cmd_state(self, _done, view=None, title=None, sidebar=None):
        self.sync_state(view, title, sidebar)
        if view:
            self.app.update_setting("view", view, push=False)
        if sidebar is not None:
            self.app.update_setting("sidebar", bool(sidebar), push=False)
        return {"ok": True}

    def cmd_focus_search(self, _done):
        if self.search_entry.get_visible():
            self.search_entry.grab_focus()
        else:
            self.search_btn.set_active(True)
            self.narrow_entry.grab_focus()
        return {"ok": True}

    def cmd_clear_search(self, _done):
        for entry in (self.search_entry, self.narrow_entry):
            entry.set_text("")
        self.search_btn.set_active(False)
        return {"ok": True}

    def cmd_action(self, _done, name):
        if name in ("preferences", "shortcuts", "about", "quit", "import"):
            self.app.activate_action(name, None)
        return {"ok": True}

    def cmd_export(self, done, text, filename="meridian.ics"):
        dialog = Gtk.FileDialog(title="Export Calendar", initial_name=filename)
        dialog.set_filters(_ics_filters())

        def finished(dlg, res):
            try:
                gfile = dlg.save_finish(res)
            except GLib.Error:
                done({"ok": False, "cancelled": True})
                return
            try:
                gfile.replace_contents(text.encode("utf-8"), None, False,
                                       Gio.FileCreateFlags.REPLACE_DESTINATION, None)
                done({"ok": True, "path": gfile.get_path()})
            except GLib.Error as err:
                done({"ok": False, "error": err.message})

        dialog.save(self, None, finished)
        return NotImplemented

    def import_ics(self):
        dialog = Gtk.FileDialog(title="Import Calendar")
        dialog.set_filters(_ics_filters())

        def finished(dlg, res):
            try:
                gfile = dlg.open_finish(res)
                ok, contents, _etag = gfile.load_contents(None)
            except GLib.Error:
                return
            if len(contents) > 20 * 1024 * 1024:
                self.emit_js("toast", {"text": "That file is too large to import."})
                return
            name = os.path.splitext(gfile.get_basename() or "Imported")[0]
            self.emit_js("import", {"name": name, "text": contents.decode("utf-8", "replace")})

        self.present()
        dialog.open(self, None, finished)

    # ------------------------------------------------------------------
    # Closing
    # ------------------------------------------------------------------
    def flush(self, then):
        """Ask the page for any unsaved state, write it, then continue."""
        def got(view, res):
            try:
                value = view.evaluate_javascript_finish(res)
                if value is not None and value.is_string():
                    self.app.data_store.save(json.loads(value.to_string()))
            except (GLib.Error, ValueError):
                pass
            then()

        if not self._ready:
            then()
            return
        self.webview.evaluate_javascript(
            "(window.M&&M.store)?M.store.takePending():null", -1, None, None, None, got)

    def save_geometry(self):
        width, height = self.get_default_size()
        self.app.settings["window"] = {
            "width": width, "height": height, "maximized": self.is_maximized()}
        self.app.save_settings()

    def _on_close_request(self, *_):
        self.save_geometry()
        if self.get_hide_on_close():
            self.flush(lambda: None)
            return False  # GTK hides the window; reminders keep running
        if getattr(self, "_closing", False):
            return False
        self._closing = True
        self.flush(self.app.quit)
        return True


def _bundled_icon(name):
    """Load one of our own symbolic icons; GTK recolours *-symbolic.svg files."""
    path = os.path.join(ICON_DIR, "scalable", "actions", f"{name}.svg")
    return Gtk.Image.new_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(path)))


def _ics_filters():
    ics = Gtk.FileFilter(name="Calendar files (.ics)")
    ics.add_suffix("ics")
    ics.add_mime_type("text/calendar")
    store = Gio.ListStore.new(Gtk.FileFilter)
    store.append(ics)
    return store

