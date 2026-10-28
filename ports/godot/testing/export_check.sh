#!/usr/bin/env bash
# Does an EXPORTED Godot game still have its bundle, by BOTH routes a game uses?
#
#   ports/godot/testing/export_check.sh
#   EXPORT_PLUGIN=/path/to/old/bundle_export_plugin.gd ports/godot/testing/export_check.sh   # a candidate
#
# NOT vendored: vendor-ports.mjs copies named files only, and this one tests the shared editor plugins
# themselves, which no product test host can do without dragging its own runtime in. expr has no Godot
# project, so the script builds one in a temp folder: a stand-in family ("demo", `.democ`) with the
# shared importer and export plugin vendored by hand, a Resource like the products' (json_text and
# import_error), and a game that asks for its bundle three ways:
#
#   1. `FileAccess.get_file_as_string("res://game.democ")`: the raw bytes, how every existing game loads.
#   2. `load("res://game.democ")`: the imported Resource (Patterplay's PatterBundleResource, the Storylet
#      Engine's StoryletBundleResource). This is the route the 0.4.3 export fix broke: it skipped the
#      imported product, so an exported game had the raw file and no `.import` remap, and load() found
#      nothing. In the editor the remap and `.godot/imported/` are on disk, so nothing in the editor
#      could see it.
#   3. The same Resource held by a scene (`@export var bundle`, saved by uid), which is how a project
#      that drags the asset onto a node gets it.
#
# And one size check: the pack must not carry the bundle twice (measured at 7.2 MB against 3.6 MB for a
# 3.4 MB bundle when it did).
#
# Each export is run from a folder with NO project.godot above it, or Godot reads the source tree
# instead of the export. Two exports, when the templates are there: `--export-pack` run with
# `--main-pack` (needs no templates; the .pck is what a full export embeds), then a full macOS
# `--export-release` whose app is run directly. Without the templates only the first runs, and says so.
#
# Prints `EXPORT CHECK: ALL PASS` (exit 0) or `EXPORT CHECK: N FAILED` (exit 1); skips (exit 0) with no Godot.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.."
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
export_plugin="${EXPORT_PLUGIN:-$src/bundle_export_plugin.gd}"

if [ ! -x "$godot" ]; then
  echo "SKIP export_check: no Godot at $godot (set GODOT=/path/to/godot)"
  exit 0
fi
version="$("$godot" --headless --version 2>/dev/null | head -1)"
templates="$HOME/Library/Application Support/Godot/export_templates/$(echo "$version" | cut -d. -f1-3)"

proj="$(mktemp -d)"
run="$(mktemp -d)"                     # deliberately NOT under $proj: no project.godot above it
trap '[ -n "${KEEP:-}" ] && echo "kept $proj" || rm -rf "$proj" "$run"' EXIT

addon="$proj/addons/demobundle"
mkdir -p "$addon/expr"
cp "$export_plugin" "$addon/expr/bundle_export_plugin.gd"
cp "$src/bundle_import_plugin.gd" "$addon/expr/bundle_import_plugin.gd"

cat > "$addon/plugin.cfg" <<'CFG'
[plugin]

name="Demo Bundle"
description="export_check stand-in family"
author="expr"
version="0"
script="plugin.gd"
CFG

cat > "$addon/plugin.gd" <<'GD'
@tool
extends EditorPlugin

var _import_plugin: EditorImportPlugin
var _export_plugin: EditorExportPlugin


func _enter_tree() -> void:
	_export_plugin = preload("res://addons/demobundle/demo_export_plugin.gd").new()
	add_export_plugin(_export_plugin)
	_import_plugin = preload("res://addons/demobundle/demo_import_plugin.gd").new()
	add_import_plugin(_import_plugin)


func _exit_tree() -> void:
	remove_import_plugin(_import_plugin)
	remove_export_plugin(_export_plugin)
GD

cat > "$addon/demo_export_plugin.gd" <<'GD'
@tool
extends "res://addons/demobundle/expr/bundle_export_plugin.gd"


func _init() -> void:
	plugin_name = "DemoBundleExport"
	bundle_extension = ".democ"
	addon_label = "DemoBundle"
GD

cat > "$addon/demo_import_plugin.gd" <<'GD'
@tool
extends "res://addons/demobundle/expr/bundle_import_plugin.gd"


func _init() -> void:
	importer_name = "demobundle.bundle"
	visible_name = "Demo Bundle"
	bundle_extension = "democ"
	log_prefix = "DemoBundleImportPlugin"


func _make_resource() -> Resource:
	return DemoBundleResource.new()
GD

# The products' resources, cut down to what the shared importer touches.
cat > "$addon/demo_bundle_resource.gd" <<'GD'
@tool
class_name DemoBundleResource
extends Resource

@export_multiline var json_text: String = "":
	set(value):
		json_text = value
		_parsed = false
@export var import_error: String = ""

var _parsed := false
var _bundle: Dictionary = {}


func get_bundle() -> Dictionary:
	if not _parsed:
		_parsed = true
		var data = JSON.parse_string(json_text)
		_bundle = data if typeof(data) == TYPE_DICTIONARY else {}
	return _bundle


func is_valid() -> bool:
	return get_bundle().has("scenes")


func get_errors() -> PackedStringArray:
	return PackedStringArray() if is_valid() else PackedStringArray(["not a bundle"])
GD

# A bundle big enough that carrying it twice shows in the pack size (about 1 MB).
python3 - "$proj/game.democ" <<'PY'
import json, sys
lines = {f"line{i}": "x" * 100 for i in range(10000)}
json.dump({"content": {"project": "export-check"}, "scenes": {"s": {"lines": lines}}}, open(sys.argv[1], "w"))
PY

cat > "$proj/project.godot" <<'CFG'
config_version=5

[application]
config/name="expr bundle export check"
run/main_scene="res://main.tscn"

[editor_plugins]
enabled=PackedStringArray("res://addons/demobundle/plugin.cfg")

[rendering]
textures/vram_compression/import_etc2_astc=true
CFG

cat > "$proj/holder.gd" <<'GD'
extends Node

@export var bundle: Resource
GD

cat > "$proj/main.gd" <<'GD'
extends Node

var fails := 0


func check(ok: bool, what: String) -> void:
	print("EXPORT CHECK: %s %s" % ["ok  " if ok else "FAIL", what])
	if not ok:
		fails += 1


func _ready() -> void:
	var path := "res://game.democ"
	var raw := FileAccess.get_file_as_string(path)
	check(raw.length() > 0 and JSON.parse_string(raw) is Dictionary,
		"FileAccess reads the raw bundle (%d chars)" % raw.length())

	var res = load(path) if ResourceLoader.exists(path) else null
	check(res is DemoBundleResource, "load() gives a DemoBundleResource (got %s)" % [res])
	if res is DemoBundleResource:
		check(res.json_text == raw, "its json_text is the raw bundle (%d chars)" % res.json_text.length())
		check(res.is_valid() and res.get_bundle().get("content", {}).get("project") == "export-check",
			"it parses")

	# A separate scene, so a dependency that will not load fails this check and not the whole game.
	var scene = load("res://holder.tscn") if ResourceLoader.exists("res://holder.tscn") else null
	var held = scene.instantiate().bundle if scene is PackedScene else null
	check(held is DemoBundleResource and held.json_text == raw,
		"a scene's exported Resource reference loads it (got %s)" % [held])

	print("EXPORT CHECK: game %s" % ["PASSED" if fails == 0 else "%d FAILED" % fails])
	get_tree().quit(1 if fails else 0)
GD

cat > "$proj/main.tscn" <<'TSCN'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node"]
script = ExtResource("1")
TSCN

"$godot" --headless --path "$proj" --import >/dev/null 2>&1 || true

if [ ! -f "$proj/game.democ.import" ]; then
  echo "EXPORT CHECK: FAIL - the stand-in importer did not import game.democ, so nothing here is tested"
  exit 1
fi
uid="$(sed -n 's/^uid="\(.*\)"$/\1/p' "$proj/game.democ.import")"

# The scene refers to the bundle the way the editor saves a dragged-in asset: by uid, with its path.
cat > "$proj/holder.tscn" <<TSCN
[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://holder.gd" id="1"]
[ext_resource type="Resource" uid="$uid" path="res://game.democ" id="2"]

[node name="Holder" type="Node"]
script = ExtResource("1")
bundle = ExtResource("2")
TSCN

cat > "$proj/export_presets.cfg" <<'CFG'
[preset.0]

name="pack"
platform="Linux"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="build/check.pck"

[preset.0.options]

binary_format/embed_pck=false

[preset.1]

name="mac"
platform="macOS"
runnable=true
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="build/check.app"

[preset.1.options]

application/bundle_identifier="dev.expr.exportcheck"
codesign/codesign=1
notarization/notarization=0
CFG
"$godot" --headless --path "$proj" --import >/dev/null 2>&1 || true

fails=0
bundle_bytes=$(wc -c < "$proj/game.democ" | tr -d ' ')

# Run what an export produced, from $run, and judge it by the game's own verdict.
judge() {
  local label="$1"; shift
  local out
  out="$("$@" 2>&1 || true)"
  echo "$out" | grep -E "^EXPORT CHECK: " | sed "s/^EXPORT CHECK: /EXPORT CHECK: [$label] /" || true
  if ! echo "$out" | grep -q "EXPORT CHECK: game PASSED"; then
    echo "$out" | grep -E "ERROR|SCRIPT ERROR" | head -5
    fails=$((fails + 1))
  fi
}

# --- 1. a pack, run with --main-pack ---------------------------------------------
mkdir -p "$proj/build"
export_out="$("$godot" --headless --path "$proj" --export-pack pack "$proj/build/check.pck" 2>&1 || true)"
if echo "$export_out" | grep -qE "Program crashed|Abort trap"; then
  echo "EXPORT CHECK: FAIL - Godot crashed during the pack export"
  fails=$((fails + 1))
fi
if [ ! -f "$proj/build/check.pck" ]; then
  echo "EXPORT CHECK: FAIL - no pack was produced"
  echo "$export_out" | tail -5
  exit 1
fi
pack_bytes=$(wc -c < "$proj/build/check.pck" | tr -d ' ')
echo "EXPORT CHECK: [pack] $pack_bytes bytes for a $bundle_bytes-byte bundle"
# Everything else in the pack is a few tens of KB; a second copy of the bundle is a whole bundle more.
if [ "$pack_bytes" -ge $((bundle_bytes * 3 / 2)) ]; then
  echo "EXPORT CHECK: FAIL [pack] the pack carries the bundle twice"
  fails=$((fails + 1))
fi
cp "$proj/build/check.pck" "$run/check.pck"
judge pack "$godot" --headless --main-pack "$run/check.pck"

# --- 2. a full macOS export, when the templates are installed ----------------------
if [ "$(uname)" = "Darwin" ] && [ -f "$templates/macos.zip" ]; then
  export_out="$("$godot" --headless --path "$proj" --export-release mac "$proj/build/check.app" 2>&1 || true)"
  app_bin="$(ls "$proj/build/check.app/Contents/MacOS/"* 2>/dev/null | head -1 || true)"
  if [ -z "$app_bin" ]; then
    echo "EXPORT CHECK: FAIL - the macOS export produced no app"
    echo "$export_out" | grep -E "ERROR" | head -5
    fails=$((fails + 1))
  else
    cp -R "$proj/build/check.app" "$run/check.app"
    judge macos "$run/check.app/Contents/MacOS/$(basename "$app_bin")" --headless
  fi
else
  echo "EXPORT CHECK: note - no macOS export templates at $templates, so only the pack was exported"
fi

if [ "$fails" -eq 0 ]; then
  echo "EXPORT CHECK: ALL PASS ($version)"
else
  echo "EXPORT CHECK: $fails FAILED"
  exit 1
fi
