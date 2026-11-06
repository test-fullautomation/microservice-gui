#!/usr/bin/env bash
#
# Debian .deb postinst hook for DevAtServGUI.
#
# `apt install ./devatservgui_*.deb` runs this script as root after the
# files are unpacked.  We:
#   1. Detect Consul + Nomad on the host and report status.
#   2. If stdin is a TTY (the user invoked apt from a terminal), launch
#      the interactive bootstrap.sh so they can install / provide paths.
#   3. Otherwise (e.g. the deb was installed via Ansible / a CI pipeline),
#      print a clear note pointing at bootstrap.sh for the user to run
#      later.
#
# bootstrap.sh ships next to this file in /opt/<app>/resources/.

set -e

# electron-builder does not export an install-dir variable to this hook, and
# the app installs under its productName (/opt/DevAtServGUI), so use the
# first known location that actually holds our resources.
APP_RESOURCES=""
for _cand in "${INSTALL_DIR:-}/resources" /opt/DevAtServGUI/resources /opt/devatservgui/resources; do
    if [[ "$_cand" != "/resources" && -d "$_cand" ]]; then
        APP_RESOURCES="$_cand"
        break
    fi
done
APP_RESOURCES="${APP_RESOURCES:-/opt/DevAtServGUI/resources}"
BOOTSTRAP="$APP_RESOURCES/bootstrap.sh"
APP_DIR="$(dirname "$APP_RESOURCES")"

# What electron-builder's own after-install script does, which ours replaces:
# the `devatservgui` command, and the SUID sandbox helper Electron refuses
# to start without.
ln -sf "$APP_DIR/devatservgui" /usr/bin/devatservgui || true
if [[ -f "$APP_DIR/chrome-sandbox" ]]; then
    chown root:root "$APP_DIR/chrome-sandbox" || true
    chmod 4755 "$APP_DIR/chrome-sandbox" || true
fi

PY_BIN="$APP_RESOURCES/python-runtime/bin/python3.13"
if [[ ! -x "$PY_BIN" ]]; then
    echo "ERROR: bundled Python runtime is missing: $PY_BIN" >&2
    exit 1
fi
echo "DevAtServGUI: using bundled Python runtime; no system Python or pip install required."

echo
echo "DevAtServGUI: post-install infrastructure check"
echo "-----------------------------------------------"

CONSUL_PATH="$(command -v consul 2>/dev/null || true)"
NOMAD_PATH="$(command -v nomad  2>/dev/null || true)"

if [[ -n "$CONSUL_PATH" ]]; then
    echo "  consul: detected at $CONSUL_PATH"
else
    echo "  consul: NOT FOUND"
fi
if [[ -n "$NOMAD_PATH" ]]; then
    echo "  nomad:  detected at $NOMAD_PATH"
else
    echo "  nomad:  NOT FOUND"
fi

# Both present — nothing to do.
if [[ -n "$CONSUL_PATH" && -n "$NOMAD_PATH" ]]; then
    echo
    echo "Both tools found.  No further action needed."
    exit 0
fi

if [[ -t 0 && -t 1 ]]; then
    echo
    echo "Launching interactive bootstrap to fix missing tool(s)..."
    if [[ -x "$BOOTSTRAP" ]]; then
        bash "$BOOTSTRAP" || true
    else
        echo "  (bootstrap.sh not found at $BOOTSTRAP — skipping interactive setup)"
    fi
else
    echo
    echo "To finish setup, run the bootstrap script interactively:"
    echo "    bash $BOOTSTRAP"
fi

exit 0
