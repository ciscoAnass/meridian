#!/usr/bin/env bash
# Build the Meridian .deb package.
#   ./packaging/build-deb.sh            -> dist/meridian-calendar_<version>_all.deb
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKG=meridian-calendar
APP_ID=io.github.meridiancal.Meridian
VERSION="$(python3 -c 'import meridian; print(meridian.VERSION)')"
STAGE="$ROOT/build/deb/${PKG}_${VERSION}_all"
OUT="$ROOT/dist"

echo "==> Checking sources"
python3 -m py_compile meridian/*.py
command -v node >/dev/null && node tests/logic.test.js >/dev/null && echo "    logic tests passed"
command -v desktop-file-validate >/dev/null && desktop-file-validate "data/$APP_ID.desktop"

echo "==> Staging $PKG $VERSION"
rm -rf "$STAGE"
SHARE="$STAGE/usr/share/$PKG"
install -d "$STAGE/DEBIAN" "$STAGE/usr/bin" "$SHARE/meridian" "$SHARE/web" \
           "$STAGE/usr/share/applications" "$STAGE/usr/share/metainfo" "$STAGE/usr/share/doc/$PKG"

install -m 0644 meridian/*.py "$SHARE/meridian/"
cp -r web/. "$SHARE/web/"
install -d "$SHARE/data/icons/hicolor/scalable/actions"
install -m 0644 data/icons/hicolor/scalable/actions/*.svg "$SHARE/data/icons/hicolor/scalable/actions/"
install -m 0755 bin/meridian-calendar "$STAGE/usr/bin/meridian-calendar"
install -m 0644 "data/$APP_ID.desktop" "$STAGE/usr/share/applications/"
install -m 0644 "data/$APP_ID.metainfo.xml" "$STAGE/usr/share/metainfo/"

# App icons (scalable, PNG sizes, symbolic)
for dir in data/icons/hicolor/*/apps; do
  dest="$STAGE/usr/share/icons/hicolor/${dir#data/icons/hicolor/}"
  install -d "$dest"
  install -m 0644 "$dir"/* "$dest/"
done

# AppArmor profile (Ubuntu 24.04+ needs it for WebKit's sandbox)
install -d "$STAGE/etc/apparmor.d"
install -m 0644 data/apparmor/meridian-calendar "$STAGE/etc/apparmor.d/meridian-calendar"

# Manual page
install -d "$STAGE/usr/share/man/man1"
gzip -9n < data/man/meridian-calendar.1 > "$STAGE/usr/share/man/man1/meridian-calendar.1.gz"

# Documentation
install -m 0644 README.md "$STAGE/usr/share/doc/$PKG/README.md"
{
  echo "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/"
  echo "Upstream-Name: Meridian"
  echo
  echo "Files: *"
  echo "Copyright: 2026 The Meridian contributors"
  echo "License: GPL-3.0-or-later"
  echo " On Debian systems, the full text is in /usr/share/common-licenses/GPL-3."
  echo
  echo "Files: web/fonts/*"
  echo "Copyright: 2016 The Inter Project Authors"
  echo "License: OFL-1.1"
  sed 's/^/ /; s/^ $/ ./' web/fonts/INTER-LICENSE.txt
} > "$STAGE/usr/share/doc/$PKG/copyright"
printf '%s (%s) stable; urgency=low\n\n  * First release.\n\n -- The Meridian contributors <meridian@users.noreply.github.com>  %s\n' \
  "$PKG" "$VERSION" "$(date -R)" | gzip -9n > "$STAGE/usr/share/doc/$PKG/changelog.gz"
rm -f "$SHARE/web/fonts/INTER-LICENSE.txt"   # carried in the copyright file

SIZE_KB="$(du -sk --exclude=DEBIAN "$STAGE" | cut -f1)"
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $VERSION
Section: gnome
Priority: optional
Architecture: all
Installed-Size: $SIZE_KB
Depends: python3 (>= 3.10), python3-gi (>= 3.42), gir1.2-gtk-4.0 (>= 4.12), gir1.2-adw-1 (>= 1.5), gir1.2-webkit-6.0, librsvg2-common
Recommends: xdg-desktop-portal-gnome | xdg-desktop-portal-gtk
Maintainer: The Meridian contributors <meridian@users.noreply.github.com>
Description: calm, private calendar for the GNOME desktop
 Meridian is a fast, beautiful calendar that keeps your schedule on your
 own computer. There are no accounts, no tracking and no network access.
 .
 It offers day, week, month and agenda views, drag-and-drop editing,
 repeating events, desktop reminders, colour-coded calendars, search,
 undo, and .ics import and export.
CONTROL

# Byte-compile on install for fast startup; clean up on removal.
cat > "$STAGE/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  python3 -m compileall -q /usr/share/meridian-calendar/meridian >/dev/null 2>&1 || true
  # Load the AppArmor profile now, so Meridian works without a reboot.
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser -r -T -W /etc/apparmor.d/meridian-calendar || true
  fi
fi
POSTINST
cat > "$STAGE/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
rm -rf /usr/share/meridian-calendar/meridian/__pycache__
if [ "$1" = "remove" ] && command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
  apparmor_parser -R /etc/apparmor.d/meridian-calendar >/dev/null 2>&1 || true
fi
PRERM
echo "/etc/apparmor.d/meridian-calendar" > "$STAGE/DEBIAN/conffiles"
chmod 0755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm"

find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE/usr/share" "$STAGE/etc" -type f -exec chmod 0644 {} +

echo "==> Building package"
mkdir -p "$OUT"
DEB="$OUT/${PKG}_${VERSION}_all.deb"
dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$DEB" >/dev/null
echo "    $DEB ($(du -h "$DEB" | cut -f1))"
if command -v lintian >/dev/null; then
  echo "==> lintian"
  lintian --tag-display-limit 0 "$DEB" 2>/dev/null || true
fi
