"""Local, crash-safe storage.

Everything Meridian knows lives in two small JSON files under the XDG data
and config directories. Writes are atomic (write to a temp file, fsync,
rename), so a power cut mid-save can never leave a half-written calendar.
A rolling set of daily backups is kept next to the data file.
"""

import datetime
import json
import os
import shutil
import tempfile

from gi.repository import GLib

APP_DIR = "meridian"
BACKUPS_TO_KEEP = 7


def _ensure_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def data_dir():
    override = os.environ.get("MERIDIAN_DATA_DIR")
    if override:
        return _ensure_dir(override)
    return _ensure_dir(os.path.join(GLib.get_user_data_dir(), APP_DIR))


def config_dir():
    override = os.environ.get("MERIDIAN_DATA_DIR")
    if override:
        return _ensure_dir(override)
    return _ensure_dir(os.path.join(GLib.get_user_config_dir(), APP_DIR))


class JsonStore:
    """A single JSON document persisted atomically."""

    def __init__(self, path, default=None, backups=False):
        self.path = path
        self.default = default if default is not None else {}
        self.backups = backups

    # -- reading -------------------------------------------------------
    def load(self):
        for candidate in [self.path] + self._backup_files():
            try:
                with open(candidate, "r", encoding="utf-8") as fh:
                    value = json.load(fh)
                if candidate != self.path:
                    # We recovered from a backup; keep the damaged original
                    # aside so nothing is ever silently discarded.
                    self._quarantine()
                return value
            except FileNotFoundError:
                continue
            except (OSError, ValueError):
                continue
        return json.loads(json.dumps(self.default))

    # -- writing -------------------------------------------------------
    def save(self, value):
        directory = os.path.dirname(self.path)
        _ensure_dir(directory)
        if self.backups:
            self._rotate_backup()
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # -- backups -------------------------------------------------------
    def _backup_dir(self):
        return os.path.join(os.path.dirname(self.path), "backups")

    def _backup_files(self):
        if not self.backups:
            return []
        directory = self._backup_dir()
        try:
            names = sorted(os.listdir(directory), reverse=True)
        except OSError:
            return []
        return [os.path.join(directory, n) for n in names if n.endswith(".json")]

    def _rotate_backup(self):
        if not os.path.exists(self.path):
            return
        directory = _ensure_dir(self._backup_dir())
        stem = os.path.splitext(os.path.basename(self.path))[0]
        today = datetime.date.today().isoformat()
        target = os.path.join(directory, f"{stem}-{today}.json")
        if os.path.exists(target):
            return
        try:
            shutil.copy2(self.path, target)
            os.chmod(target, 0o600)
        except OSError:
            return
        for old in self._backup_files()[BACKUPS_TO_KEEP:]:
            try:
                os.unlink(old)
            except OSError:
                pass

    def _quarantine(self):
        if os.path.exists(self.path):
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            try:
                os.replace(self.path, f"{self.path}.damaged-{stamp}")
            except OSError:
                pass
