#!/bin/sh
# Build the viewer to its own file and screenshot it in headless Edge (one copy per caller, so parallel work can't clash).
#   sh industrial-design/shot.sh <name> <hash> [width height]     (run from hardware/)
#   -> industrial-design/out/shots/<name>.html, <name>-<hash>.png, <name>-<hash>.log (browser console)
# <hash>: hero | side | top | under | inside | water | floats  (opens that view / toggle)
set -e
NAME=$1; HASH=$2; W=${3:-1200}; H=${4:-900}
DIR="$(pwd)/industrial-design/out/shots"
mkdir -p "$DIR"
python industrial-design/build_viewer.py --out "$DIR/$NAME.page.html" >/dev/null
python -c "
import pathlib, sys
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
pathlib.Path(sys.argv[2]).write_text('<!doctype html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width\"></head><body>' + src + '</body></html>', encoding='utf-8')
" "$DIR/$NAME.page.html" "$DIR/$NAME.html"
WIN=$(cygpath -w "$DIR")
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --enable-logging=stderr --v=0 --window-size=$W,$H --virtual-time-budget=20000 \
  --screenshot="$WIN\\$NAME-$HASH.png" "file:///$WIN\\$NAME.html#$HASH" 2> "$DIR/$NAME-$HASH.log" || true
grep "CONSOLE" "$DIR/$NAME-$HASH.log" | grep -v "Tracking Prevention" | head -20 || true   # page console only
echo "$WIN\\$NAME-$HASH.png"
