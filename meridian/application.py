"""The Meridian application: lifecycle, actions, settings and native dialogs."""

import os
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("WebKit", "6.0")
gi.require_version("JavaScriptCore", "6.0")

from gi.repository import Adw, Gio, GLib, Gtk  # noqa: E402

from . import APP_ID, APP_NAME, VERSION  # noqa: E402
from .storage import JsonStore, config_dir, data_dir  # noqa: E402
from .window import MeridianWindow  # noqa: E402

DEFAULT_SETTINGS = {
    "color_scheme": "system",      # system | light | dark
    "week_start": "auto",          # auto | 0 (Sun) | 1 (Mon) | 6 (Sat)
    "time_format": "auto",         # auto | 24 | 12
    "day_start_hour": 8,
    "default_duration": 60,        # minutes
    "default_alert": 10,           # minutes before, -1 = none
    "show_week_numbers": False,
    "run_in_background": True,
    "autostart": False,
    "sidebar": True,
    "view": "month",
    "window": {"width": 1180, "height": 780, "maximized": False},
}

WEEK_START_CHOICES = [("auto", "Automatic"), ("1", "Monday"), ("0", "Sunday"), ("6", "Saturday")]
TIME_FORMAT_CHOICES = [("auto", "Automatic"), ("24", "24-hour"), ("12", "12-hour")]
SCHEME_CHOICES = [("system", "Follow system"), ("light", "Light"), ("dark", "Dark")]
DURATION_CHOICES = [(15, "15 minutes"), (30, "30 minutes"), (45, "45 minutes"),
                    (60, "1 hour"), (90, "1½ hours"), (120, "2 hours")]
ALERT_CHOICES = [(-1, "None"), (0, "At time of event"), (5, "5 minutes before"),
                 (10, "10 minutes before"), (15, "15 minutes before"),
                 (30, "30 minutes before"), (60, "1 hour before"), (1440, "1 day before")]

SHORTCUTS_UI = """
<interface>
  <object class="GtkShortcutsWindow" id="shortcuts">
    <property name="modal">True</property>
    <child>
      <object class="GtkShortcutsSection">
        <property name="section-name">main</property>
        <property name="max-height">12</property>
        <child>
          <object class="GtkShortcutsGroup">
            <property name="title">Navigation</property>
            <child><object class="GtkShortcutsShortcut"><property name="title">Go to today</property><property name="accelerator">t</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Previous period</property><property name="accelerator">Left j</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Next period</property><property name="accelerator">Right k</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Day view</property><property name="accelerator">d 1</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Week view</property><property name="accelerator">w 2</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Month view</property><property name="accelerator">m 3</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Agenda view</property><property name="accelerator">a 4</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Show or hide the sidebar</property><property name="accelerator">&lt;Ctrl&gt;b</property></object></child>
          </object>
        </child>
        <child>
          <object class="GtkShortcutsGroup">
            <property name="title">Events</property>
            <child><object class="GtkShortcutsShortcut"><property name="title">New event</property><property name="accelerator">n &lt;Ctrl&gt;n</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Delete selected event</property><property name="accelerator">Delete</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Close editor</property><property name="accelerator">Escape</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Undo</property><property name="accelerator">&lt;Ctrl&gt;z</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Redo</property><property name="accelerator">&lt;Ctrl&gt;&lt;Shift&gt;z</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Search events</property><property name="accelerator">&lt;Ctrl&gt;f slash</property></object></child>
          </object>
        </child>
        <child>
          <object class="GtkShortcutsGroup">
            <property name="title">General</property>
            <child><object class="GtkShortcutsShortcut"><property name="title">Preferences</property><property name="accelerator">&lt;Ctrl&gt;comma</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Keyboard shortcuts</property><property name="accelerator">&lt;Ctrl&gt;question</property></object></child>
            <child><object class="GtkShortcutsShortcut"><property name="title">Quit</property><property name="accelerator">&lt;Ctrl&gt;q</property></object></child>
          </object>
        </child>
      </object>
    </child>
  </object>
</interface>
"""


class MeridianApplication(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        GLib.set_application_name(APP_NAME)
        self.window = None
        self.start_hidden = False
        self.debug = bool(os.environ.get("MERIDIAN_DEBUG"))
        self._held = False
        self._prefs = None
        self._pending_new = False

        self.settings_store = JsonStore(os.path.join(config_dir(), "settings.json"))
        self.data_store = JsonStore(os.path.join(data_dir(), "calendar.json"), backups=True)
        self.settings = {}

        self.add_main_option("background", ord("b"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Start without opening a window (reminders keep working)", None)
        self.add_main_option("new-event", ord("n"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Open Meridian ready to add a new event", None)
        self.add_main_option("debug", 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Enable the web inspector", None)
        self.add_main_option("version", ord("v"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Print the version and exit", None)
        self.connect("handle-local-options", self._on_local_options)

    # -- lifecycle -----------------------------------------------------
    def _on_local_options(self, _app, options):
        opts = options.end().unpack()
        if "version" in opts:
            print(f"{APP_NAME} {VERSION}")
            return 0
        self.start_hidden = "background" in opts
        self.debug = self.debug or "debug" in opts
        if "new-event" in opts:
            self.register(None)
            if self.get_is_remote():
                # Meridian is already running: forward to it and exit.
                self.activate_action("new-event", None)
                return 0
            self._pending_new = True
        return -1

    def do_startup(self):
        Adw.Application.do_startup(self)
        self.settings = self._load_settings()
        self.apply_color_scheme()

        for name, handler, param in [
            ("quit", self._on_quit, None),
            ("preferences", self._on_preferences, None),
            ("shortcuts", self._on_shortcuts, None),
            ("about", self._on_about, None),
            ("import", lambda *_: self.window and self.window.import_ics(), None),
            ("export", lambda *_: self.window and self.window.emit_js("request-export", {}), None),
            ("new-event", lambda *_: self._present_and_emit("new", {}), None),
            ("show-event", self._on_show_event, GLib.VariantType.new("s")),
        ]:
            action = Gio.SimpleAction.new(name, param)
            action.connect("activate", handler)
            self.add_action(action)

        self.set_accels_for_action("app.quit", ["<Control>q"])
        self.set_accels_for_action("app.preferences", ["<Control>comma"])
        self.set_accels_for_action("app.shortcuts", ["<Control>question"])
        self._sync_background_hold()

    def do_activate(self):
        if self.window is None:
            self.window = MeridianWindow(self)
            if self._pending_new:
                self._pending_new = False
                self.window.emit_js("new", {})  # queued until the page is ready
            if self.start_hidden:
                self.start_hidden = False
                return  # window stays hidden; web view still loads for reminders
        self.window.present()

    # -- settings ------------------------------------------------------
    def _load_settings(self):
        stored = self.settings_store.load() or {}
        merged = dict(DEFAULT_SETTINGS)
        merged.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
        merged["window"] = {**DEFAULT_SETTINGS["window"], **(stored.get("window") or {})}
        return merged

    def save_settings(self):
        self.settings_store.save(self.settings)

    def update_setting(self, key, value, push=True):
        if key not in DEFAULT_SETTINGS or self.settings.get(key) == value:
            return
        self.settings[key] = value
        self.save_settings()
        if key == "color_scheme":
            self.apply_color_scheme()
        elif key == "run_in_background":
            self._sync_background_hold()
        elif key == "autostart":
            self._sync_autostart()
        if push and self.window:
            self.window.emit_js("settings", self.settings)

    def apply_color_scheme(self):
        scheme = {
            "light": Adw.ColorScheme.FORCE_LIGHT,
            "dark": Adw.ColorScheme.FORCE_DARK,
        }.get(self.settings.get("color_scheme"), Adw.ColorScheme.DEFAULT)
        Adw.StyleManager.get_default().set_color_scheme(scheme)

    def _sync_background_hold(self):
        want = bool(self.settings.get("run_in_background"))
        if want and not self._held:
            self.hold()
            self._held = True
        elif not want and self._held:
            self.release()
            self._held = False
        if self.window:
            self.window.set_hide_on_close(want)

    def _sync_autostart(self):
        folder = os.path.join(GLib.get_user_config_dir(), "autostart")
        path = os.path.join(folder, f"{APP_ID}.desktop")
        if self.settings.get("autostart"):
            os.makedirs(folder, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(
                    "[Desktop Entry]\nType=Application\n"
                    f"Name={APP_NAME}\nComment=Deliver calendar reminders\n"
                    f"Exec=meridian-calendar --background\nIcon={APP_ID}\n"
                    "X-GNOME-Autostart-enabled=true\nNoDisplay=true\n"
                )
        else:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass

    # -- notifications -------------------------------------------------
    def send_reminder(self, key, title, body):
        note = Gio.Notification.new(title or "Event")
        if body:
            note.set_body(body)
        note.set_icon(Gio.ThemedIcon.new(APP_ID))
        note.set_priority(Gio.NotificationPriority.HIGH)
        note.set_default_action_and_target("app.show-event", GLib.Variant("s", key))
        note.add_button_with_target("Show", "app.show-event", GLib.Variant("s", key))
        self.send_notification(f"reminder-{key}", note)
        if self.debug:
            print(f"meridian: reminder sent: {title!r} / {body!r}", flush=True)

    def _on_show_event(self, _action, param):
        self._present_and_emit("show-event", {"key": param.get_string()})

    def _present_and_emit(self, name, payload):
        self.activate()
        if self.window:
            self.window.emit_js(name, payload)

    # -- actions -------------------------------------------------------
    def _on_quit(self, *_):
        if self.window:
            self.window.flush(self._really_quit)
        else:
            self._really_quit()

    def _really_quit(self):
        if self._held:
            self.release()
            self._held = False
        if self.window:
            self.window.save_geometry()
            self.window.destroy()
        self.quit()

    def _on_shortcuts(self, *_):
        builder = Gtk.Builder.new_from_string(SHORTCUTS_UI, -1)
        win = builder.get_object("shortcuts")
        win.set_transient_for(self.window)
        win.present()

    def _on_about(self, *_):
        about = Adw.AboutDialog(
            application_name=APP_NAME,
            application_icon=APP_ID,
            version=VERSION,
            developer_name="The Meridian contributors",
            comments="A calm, private calendar. Your schedule stays on this computer: "
                     "no accounts, no tracking, no network access.",
            license_type=Gtk.License.GPL_3_0,
            copyright="© 2026 The Meridian contributors",
        )
        about.add_legal_section("Inter typeface", "© The Inter Project Authors",
                                Gtk.License.CUSTOM, "SIL Open Font License 1.1")
        about.present(self.window)

    def _on_preferences(self, *_):
        if self._prefs is not None:
            return
        self._prefs = PreferencesDialog(self)
        self._prefs.connect("closed", lambda *_: setattr(self, "_prefs", None))
        self._prefs.present(self.window)


class PreferencesDialog(Adw.PreferencesDialog):
    """Native libadwaita preferences, bound to the JSON settings."""

    def __init__(self, app):
        super().__init__(title="Preferences", search_enabled=False)
        self.app = app
        s = app.settings
        page = Adw.PreferencesPage(title="General", icon_name="preferences-system-symbolic")
        self.add(page)

        look = Adw.PreferencesGroup(title="Appearance")
        page.add(look)
        look.add(self._combo("Style", SCHEME_CHOICES, s["color_scheme"], "color_scheme"))

        cal = Adw.PreferencesGroup(title="Calendar")
        page.add(cal)
        cal.add(self._combo("Week starts on", WEEK_START_CHOICES, str(s["week_start"]), "week_start"))
        cal.add(self._combo("Time format", TIME_FORMAT_CHOICES, str(s["time_format"]), "time_format"))
        hour = Adw.SpinRow.new_with_range(0, 23, 1)
        hour.set_title("Day starts at")
        hour.set_subtitle("Week and day views open scrolled to this hour")
        hour.set_value(s["day_start_hour"])
        hour.connect("notify::value", lambda r, _p: app.update_setting("day_start_hour", int(r.get_value())))
        cal.add(hour)
        weeks = Adw.SwitchRow(title="Show week numbers", active=s["show_week_numbers"])
        weeks.connect("notify::active", lambda r, _p: app.update_setting("show_week_numbers", r.get_active()))
        cal.add(weeks)

        new = Adw.PreferencesGroup(title="New events")
        page.add(new)
        new.add(self._combo("Default duration", DURATION_CHOICES, s["default_duration"], "default_duration"))
        new.add(self._combo("Default alert", ALERT_CHOICES, s["default_alert"], "default_alert"))

        bg = Adw.PreferencesGroup(
            title="Reminders",
            description="Reminders are delivered by Meridian itself, so it needs to be running.")
        page.add(bg)
        keep = Adw.SwitchRow(title="Keep running in the background",
                             subtitle="Closing the window keeps reminders working",
                             active=s["run_in_background"])
        keep.connect("notify::active", lambda r, _p: app.update_setting("run_in_background", r.get_active()))
        bg.add(keep)
        login = Adw.SwitchRow(title="Start at login",
                              subtitle="Launch quietly in the background when you sign in",
                              active=s["autostart"])
        login.connect("notify::active", lambda r, _p: app.update_setting("autostart", r.get_active()))
        bg.add(login)

        data = Adw.PreferencesGroup(
            title="Your data",
            description="Stored only on this computer. Meridian never connects to the internet.")
        page.add(data)
        folder = Adw.ActionRow(title="Storage folder", subtitle=data_dir(), subtitle_selectable=True)
        open_btn = Gtk.Button(icon_name="folder-open-symbolic", valign=Gtk.Align.CENTER,
                              tooltip_text="Open folder")
        open_btn.add_css_class("flat")
        open_btn.connect("clicked", self._open_folder)
        folder.add_suffix(open_btn)
        data.add(folder)
        for title, subtitle, action in [
            ("Import calendar…", "Add events from an .ics file", "app.import"),
            ("Export calendar…", "Save every event as an .ics file", "app.export"),
        ]:
            row = Adw.ActionRow(title=title, subtitle=subtitle, activatable=True)
            row.add_suffix(Gtk.Image.new_from_icon_name("go-next-symbolic"))
            row.set_action_name(action)
            data.add(row)

    def _combo(self, title, choices, current, key):
        model = Gtk.StringList.new([label for _v, label in choices])
        row = Adw.ComboRow(title=title, model=model)
        values = [v for v, _l in choices]
        try:
            row.set_selected(values.index(current))
        except ValueError:
            row.set_selected(0)

        def changed(r, _p):
            value = values[r.get_selected()]
            if key in ("week_start", "time_format") and value != "auto":
                value = int(value)
            self.app.update_setting(key, value)

        row.connect("notify::selected", changed)
        return row

    def _open_folder(self, *_):
        Gtk.FileLauncher.new(Gio.File.new_for_path(data_dir())).launch(self.app.window, None, None)


def main(argv=None):
    GLib.set_prgname(APP_ID)
    app = MeridianApplication()
    return app.run(argv if argv is not None else sys.argv)
