#!/usr/bin/env bash
# Build SampleImportAssistant.app from SwiftPM (no Xcode required).
# Uses ad-hoc codesign (-) for local use only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> swift build -c release"
swift build -c release

BIN_DIR="$(swift build -c release --show-bin-path 2>/dev/null || true)"
if [[ -z "$BIN_DIR" || ! -d "$BIN_DIR" ]]; then
  BIN_DIR="$(find .build -type d -path '*/release' -print -quit 2>/dev/null || true)"
fi
EXEC="${BIN_DIR}/SampleImportAssistant"
if [[ ! -f "$EXEC" ]]; then
  EXEC="$(find .build -name SampleImportAssistant -type f ! -name '*.swiftmodule' 2>/dev/null | head -1)"
fi
if [[ ! -f "$EXEC" ]]; then
  echo "error: could not find built SampleImportAssistant binary under .build/"
  exit 1
fi

OUT_DIR="${SCRIPT_DIR}/build"
APP="${OUT_DIR}/SampleImportAssistant.app"
CONTENTS="${APP}/Contents"
MACOS="${CONTENTS}/MacOS"

rm -rf "$APP"
mkdir -p "$MACOS"

cp "$EXEC" "${MACOS}/SampleImportAssistant"
chmod +x "${MACOS}/SampleImportAssistant"

cp "${SCRIPT_DIR}/Info.plist" "${CONTENTS}/Info.plist"

echo "==> Created ${APP}"

if command -v codesign &>/dev/null; then
  echo "==> ad-hoc codesign (local use only)"
  codesign --force --deep -s - "$APP" || {
    echo "warning: codesign failed; you may need to right-click → Open the first time."
  }
else
  echo "warning: codesign not found; app is unsigned."
fi

echo ""
echo "Done. Open with:"
echo "  open \"${APP}\""
echo "or double-click SampleImportAssistant.app in Finder (under macos/SampleImportAssistant/build/)."
