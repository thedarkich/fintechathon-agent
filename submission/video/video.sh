#!/bin/bash
# The demo video, from the running app to an MP4: ./video.sh <step> [args]. The steps, in order:
#   install  the recorder's and the editor's packages (Playwright, Hyperframes, GSAP) and Hyperframes' headless Chrome
#   chrome   headless Chrome with a DevTools port for the recorder, at $CDP (skip it when one is already running there)
#   record   record the scenes from the app at $BASE into work/raw; name scenes to redo only those: record landing injection
#   grids    a sheet per recorded scene, one frame a second, for reading off the times scenes.py uses
#   build    encode each scene into a clip and write the composition into work/project (--no-clips: the composition only)
#   render   render work/out/demo.mp4: 1920x1080, 30 fps, no sound
#   check    frames of the render just after each caption appears and mid-zoom, as sheets in work/check
# Also: preview (the Hyperframes studio, to scrub through the edit), lint, and ffmpeg (FFmpeg and the libraries headless
# Chrome needs, from Ubuntu's own packages unpacked into work/, for a machine that lacks them and has no sudo).
NVM=${NVM_DIR:-$HOME/.nvm}/nvm.sh
if [ -s "$NVM" ]; then source "$NVM" >/dev/null; nvm use 22 >/dev/null; fi  # Hyperframes needs Node 22 or later
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
export VIDEO_WORK=${VIDEO_WORK:-$HERE/work}
export BASE=${BASE:-http://localhost:8000} CDP=${CDP:-http://localhost:9335}
WORK=$VIDEO_WORK
PROJECT=$WORK/project
PY=$REPO/backend/.venv/bin/python  # the backend's, which has Pillow
mkdir -p "$WORK"

# FFmpeg: the one `./video.sh ffmpeg` unpacked, or the system's
with_ffmpeg() {
  if [ -f "$WORK/ffroot/libpath" ]; then
    LD_LIBRARY_PATH=$(cat "$WORK/ffroot/libpath")
    export LD_LIBRARY_PATH PATH=$WORK/ffroot/usr/bin:$PATH
  fi
  command -v ffmpeg >/dev/null || return 1
  HYPERFRAMES_FFMPEG_PATH=$(command -v ffmpeg)
  HYPERFRAMES_FFPROBE_PATH=$(command -v ffprobe)
  export HYPERFRAMES_FFMPEG_PATH HYPERFRAMES_FFPROBE_PATH
}
need_ffmpeg() { with_ffmpeg || { echo "No FFmpeg: install it, or run ./video.sh ffmpeg"; exit 1; }; }

# the Hyperframes CLI on the project, with no telemetry, update checks or installs of its own
hyperframes() {
  with_ffmpeg || true
  mkdir -p "$PROJECT"
  (cd "$PROJECT" && HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_AUTO_INSTALL=1 \
    HYPERFRAMES_NO_OPTIONAL_INSTALL=1 HF_NO_BROWSER=1 BROWSER=none "$HERE/node_modules/.bin/hyperframes" "$@")
}

step=${1:-}
shift || true
case "$step" in
  install)
    (cd "$HERE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund)
    hyperframes browser ensure
    ;;
  chrome)
    chrome=${CHROME:-$(command -v google-chrome || command -v chromium || echo '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe')}
    profile=$(mktemp -d)
    # Chrome for Windows, started from WSL, keeps its profile on the Windows side
    case "$chrome" in /mnt/*) profile="$(cd /mnt/c && cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')\\cub-video-chrome-$(date +%s)" ;; esac
    "$chrome" --headless=new --remote-debugging-port="${CDP##*:}" --user-data-dir="$profile" --no-first-run \
      --no-default-browser-check --hide-scrollbars --lang=zh-CN --force-color-profile=srgb about:blank >/dev/null 2>&1 &
    for _ in $(seq 40); do curl -s "$CDP/json/version" >/dev/null && { echo "Chrome ready at $CDP"; exit 0; }; sleep 0.5; done
    echo "Chrome did not start"; exit 1
    ;;
  record)
    curl -sf -o /dev/null "$BASE/" || { echo "The app isn't answering at $BASE"; exit 1; }
    curl -sf -o /dev/null "$CDP/json/version" || { echo "No Chrome at $CDP: run ./video.sh chrome"; exit 1; }
    node "$HERE/record.mjs" "$WORK/raw" "$@"
    ;;
  grids)
    mkdir -p "$WORK/grids"
    for scene in "$WORK"/raw/*/; do "$PY" "$HERE/grid.py" "$scene" 1 "$WORK/grids/$(basename "$scene").jpg"; done
    echo "Sheets in $WORK/grids"
    ;;
  build)
    # everything the page loads is local: GSAP from npm, the app's own font and logo
    mkdir -p "$PROJECT/assets/misans"
    cp "$HERE/node_modules/gsap/dist/gsap.min.js" "$REPO/frontend/public/logo.svg" "$PROJECT/assets/"
    cp "$REPO"/frontend/node_modules/misans/lib/Normal/MiSansVF.{min.css,*.woff2} "$PROJECT/assets/misans/"
    need_ffmpeg
    "$PY" "$HERE/build_edit.py" "$@"
    ;;
  render)
    need_ffmpeg
    mkdir -p "$WORK/out"
    hyperframes render --fps 30 --output "$WORK/out/demo.mp4" "$@" </dev/null
    ;;
  check)
    need_ffmpeg
    "$PY" "$HERE/check_frames.py" "$WORK/out/demo.mp4" "$WORK/check"
    ;;
  preview) hyperframes preview --port 3002 "$@" ;;
  lint) hyperframes lint "$@" ;;
  ffmpeg)
    # Ubuntu's packages fetched with apt-get download (checked against apt's signed package lists) and unpacked:
    # nothing is installed system-wide, and the .deb files stay in work/debs for the next unpacking
    mkdir -p "$WORK/debs" "$WORK/ffroot"
    cd "$WORK/debs"
    if [ ! -f .done ]; then
      wanted=$(apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances \
        ffmpeg libnss3 libnspr4 libasound2t64 2>/dev/null | grep '^[a-z0-9]' | sort -u)
      get=()
      for p in $wanted; do
        dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' && continue
        apt-cache policy "$p" 2>/dev/null | grep -q 'Candidate: (none)' && continue
        apt-cache policy "$p" 2>/dev/null | grep -q 'Candidate:' || continue
        get+=("$p")
      done
      echo "Downloading ${#get[@]} packages"
      apt-get download "${get[@]}" 2>&1 | grep -v '^Get:' | tail -5
      touch .done
    fi
    for deb in *.deb; do dpkg -x "$deb" "$WORK/ffroot"; done
    find "$WORK/ffroot" -name '*.so*' -printf '%h\n' | sort -u | paste -sd: > "$WORK/ffroot/libpath"
    need_ffmpeg
    ffmpeg -hide_banner -version | head -1
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 1
    ;;
esac
