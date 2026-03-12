@tool
extends RefCounted

const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")
const SCREENSHOT_DIR := "res://.godot/mcp/screenshots"
const TEST_REPORT_DIR := "res://.godot/mcp/test-reports"
const GUT_RUNNER_PATH := "res://addons/gut/gut_cmdln.gd"
const GDUNIT_RUNNER_PATH := "res://addons/gdUnit4/bin/GdUnitCmdTool.gd"

var _editor_interface: EditorInterface
var _workspace_root := ""
var _runtime_debug_capture
var _runtime_state_provider: Callable


func _init(editor_interface: EditorInterface, workspace_root: String, runtime_debug_capture) -> void:
	_editor_interface = editor_interface
	_workspace_root = workspace_root
	_runtime_debug_capture = runtime_debug_capture


func set_runtime_state_provider(provider: Callable) -> void:
	_runtime_state_provider = provider


func get_capability_overrides() -> Dictionary:
	var adapter := _detect_test_adapter()
	return {
		"tests.run": "enabled" if not adapter.is_empty() else "disabled",
		"screenshot.editor": "enabled" if _can_capture_screenshots() else "disabled",
		"screenshot.runtime": "enabled" if _can_capture_screenshots() else "disabled",
		"runtime.debug": (
			"enabled"
			if _runtime_debug_capture != null
			and _runtime_debug_capture.has_method("is_supported")
			and _runtime_debug_capture.is_supported()
			and ProjectSettings.has_setting("autoload/GodotLoopMcpRuntimeTelemetry")
			else "disabled"
		)
	}


func handle_request(method: String, params: Variant = {}) -> Dictionary:
	var request_params := {}
	if typeof(params) == TYPE_DICTIONARY:
		request_params = params

	match method:
		"godot.tests.run":
			return _run_tests(request_params)
		"godot.screenshot.editor":
			return _get_editor_screenshot(request_params)
		"godot.screenshot.runtime":
			return _get_running_scene_screenshot(request_params)
		"godot.runtime.get_events":
			return _get_runtime_events(request_params)
		"godot.runtime.clear_events":
			return _clear_runtime_events()
		_:
			return {"handled": false}


func _run_tests(params: Dictionary) -> Dictionary:
	if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
		return _error(-32010, "run_tests requires WorkspaceWrite security.")

	var adapter := _detect_test_adapter(params)
	if adapter.is_empty():
		return _error(-32004, "No supported test adapter was detected.")

	var executable := str(adapter.get("executable", "")).strip_edges()
	if executable == "":
		return _error(-32004, "The test adapter did not resolve an executable.", adapter)

	var arguments: PackedStringArray = adapter.get("args", PackedStringArray())
	var output: Array = []
	var started_at := Time.get_datetime_string_from_system(true)
	var start_ticks := Time.get_ticks_msec()
	var exit_code := OS.execute(
		executable,
		arguments,
		output,
		bool(params.get("readStderr", true)),
		bool(params.get("openConsole", false))
	)
	var completed_at := Time.get_datetime_string_from_system(true)
	var output_text := _flatten_output(output)
	var parsed_payload := _parse_test_output(output_text)
	var artifact_paths := _write_test_artifacts(adapter, output_text, parsed_payload)

	return _ok(
		{
			"adapter": adapter.get("adapter", ""),
			"framework": adapter.get("framework", ""),
			"detectedBy": adapter.get("detectedBy", ""),
			"success": exit_code == 0,
			"exitCode": exit_code,
			"startedAt": started_at,
			"completedAt": completed_at,
			"durationSec": snappedf(float(Time.get_ticks_msec() - start_ticks) / 1000.0, 0.001),
			"executable": executable,
			"args": Array(arguments),
			"summary": parsed_payload.get("summary", {}),
			"parsed": parsed_payload.get("parsed", {}),
			"rawOutputPath": artifact_paths.get("rawOutputPath", ""),
			"resultJsonPath": artifact_paths.get("resultJsonPath", ""),
			"rawOutput": output_text
		}
	)


func _get_editor_screenshot(params: Dictionary) -> Dictionary:
	if not _can_capture_screenshots():
		return _error(-32004, "Editor screenshots require a non-headless editor session.")
	return _capture_window_screenshot("editor", params)


func _get_running_scene_screenshot(params: Dictionary) -> Dictionary:
	if not _can_capture_screenshots():
		return _error(-32004, "Running scene screenshots require a non-headless editor session.")

	var runtime_state := _get_runtime_state()
	if not bool(runtime_state.get("isPlayingScene", false)):
		return _error(-32004, "No scene is currently playing.")

	return _capture_window_screenshot("runtime", params)


func _get_runtime_events(params: Dictionary) -> Dictionary:
	if _runtime_debug_capture == null or not _runtime_debug_capture.has_method("get_events_payload"):
		return _error(-32004, "Runtime debug capture is unavailable.")
	return _ok(_runtime_debug_capture.get_events_payload(int(params.get("limit", 100))))


func _clear_runtime_events() -> Dictionary:
	if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
		return _error(-32010, "Clearing runtime events requires WorkspaceWrite security.")
	if _runtime_debug_capture == null or not _runtime_debug_capture.has_method("clear_events"):
		return _error(-32004, "Runtime debug capture is unavailable.")
	return _ok(
		{
			"clearedCount": int(_runtime_debug_capture.clear_events())
		}
	)


func _detect_test_adapter(params: Dictionary = {}) -> Dictionary:
	var forced_adapter := str(params.get("adapter", PluginSettings.read_tests_adapter())).strip_edges()
	var custom_command := str(params.get("command", PluginSettings.read_tests_custom_command())).strip_edges()
	var custom_args := PluginSettings.read_tests_custom_args()
	if params.has("args") and typeof(params.get("args", [])) == TYPE_ARRAY:
		custom_args = _to_string_array(params.get("args", []))
	var default_test_dir := str(params.get("testDir", PluginSettings.read_tests_default_dir())).strip_edges()

	if custom_command != "" or forced_adapter.to_lower() == "custom":
		return {
			"adapter": "Custom",
			"framework": "custom",
			"detectedBy": "settings",
			"executable": _resolve_executable_path(custom_command),
			"args": PackedStringArray(_expand_test_args(custom_args))
		}

	if forced_adapter.to_lower() in ["auto", "gdunit4"] and FileAccess.file_exists(ProjectSettings.globalize_path(GDUNIT_RUNNER_PATH)):
		return {
			"adapter": "GdUnit4",
			"framework": "gdunit4",
			"detectedBy": "addon-scan",
			"executable": OS.get_executable_path(),
			"args": PackedStringArray(
				[
					"--headless",
					"--path",
					_workspace_root,
					"-s",
					GDUNIT_RUNNER_PATH,
					"-a",
					default_test_dir
				]
			)
		}

	if forced_adapter.to_lower() in ["auto", "gut"] and FileAccess.file_exists(ProjectSettings.globalize_path(GUT_RUNNER_PATH)):
		return {
			"adapter": "GUT",
			"framework": "gut",
			"detectedBy": "addon-scan",
			"executable": OS.get_executable_path(),
			"args": PackedStringArray(
				[
					"--headless",
					"--path",
					_workspace_root,
					"-s",
					GUT_RUNNER_PATH,
					"-gdir=%s" % default_test_dir,
					"-gexit"
				]
			)
		}

	return {}


func _expand_test_args(values: Array[String]) -> Array[String]:
	var expanded: Array[String] = []
	for raw_value in values:
		expanded.append(
			raw_value.replace("${PROJECT_ROOT}", _workspace_root).replace("${GODOT_BIN}", OS.get_executable_path())
		)
	return expanded


func _resolve_executable_path(raw_command: String) -> String:
	var normalized := raw_command.replace("\\", "/")
	if normalized == "":
		return ""
	if normalized.begins_with("res://"):
		return ProjectSettings.globalize_path(normalized)
	if normalized.is_absolute_path():
		return normalized
	return normalized


func _parse_test_output(output_text: String) -> Dictionary:
	var trimmed := output_text.strip_edges()
	var parsed_json := JSON.parse_string(trimmed)
	if typeof(parsed_json) == TYPE_DICTIONARY:
		var parsed_dict: Dictionary = parsed_json
		if parsed_dict.has("summary"):
			return {
				"summary": parsed_dict.get("summary", {}),
				"parsed": parsed_dict
			}
		return {
			"summary": {
				"passed": int(parsed_dict.get("passed", 0)),
				"failed": int(parsed_dict.get("failed", 0)),
				"skipped": int(parsed_dict.get("skipped", 0)),
				"total": int(parsed_dict.get("total", 0))
			},
			"parsed": parsed_dict
		}

	var summary := {
		"passed": _extract_int_after_label(output_text, "passed"),
		"failed": maxi(_extract_int_after_label(output_text, "failed"), _extract_int_after_label(output_text, "failures")),
		"skipped": maxi(_extract_int_after_label(output_text, "skipped"), _extract_int_after_label(output_text, "pending")),
		"total": _extract_int_after_label(output_text, "total")
	}
	if int(summary.get("total", 0)) == 0:
		summary["total"] = int(summary.get("passed", 0)) + int(summary.get("failed", 0)) + int(summary.get("skipped", 0))
	return {
		"summary": summary,
		"parsed": {}
	}


func _extract_int_after_label(text: String, label: String) -> int:
	var lower := text.to_lower()
	var needle := "%s:" % label.to_lower()
	var index := lower.find(needle)
	if index < 0:
		return 0
	var cursor := index + needle.length()
	var digits := ""
	while cursor < text.length():
		var character := text.substr(cursor, 1)
		if character >= "0" and character <= "9":
			digits += character
		elif digits != "":
			break
		cursor += 1
	return int(digits) if digits != "" else 0


func _write_test_artifacts(adapter: Dictionary, output_text: String, parsed_payload: Dictionary) -> Dictionary:
	var dir_path := ProjectSettings.globalize_path(TEST_REPORT_DIR)
	var dir_error := DirAccess.make_dir_recursive_absolute(dir_path)
	if dir_error != OK:
		return {}

	var timestamp := Time.get_datetime_string_from_system(true).replace(":", "-")
	var adapter_name := str(adapter.get("adapter", "tests")).to_lower()
	var base_name := "%s-%s" % [timestamp, adapter_name]
	var raw_output_path := dir_path.path_join("%s.log" % base_name)
	var raw_file := FileAccess.open(raw_output_path, FileAccess.WRITE)
	if raw_file != null:
		raw_file.store_string(output_text)
		raw_file.close()

	var result_json_path := dir_path.path_join("%s.json" % base_name)
	var json_file := FileAccess.open(result_json_path, FileAccess.WRITE)
	if json_file != null:
		json_file.store_string(JSON.stringify(parsed_payload, "\t"))
		json_file.close()

	return {
		"rawOutputPath": raw_output_path,
		"resultJsonPath": result_json_path
	}


func _capture_window_screenshot(kind: String, params: Dictionary) -> Dictionary:
	var base_control := _editor_interface.get_base_control()
	if base_control == null:
		return _error(-32004, "The editor base control is unavailable.")

	var window := base_control.get_window()
	if window == null:
		return _error(-32004, "The editor window is unavailable.")

	var dir_path := ProjectSettings.globalize_path(SCREENSHOT_DIR)
	var dir_error := DirAccess.make_dir_recursive_absolute(dir_path)
	if dir_error != OK:
		return _error(-32010, "Failed to create the screenshot directory.", {"error": dir_error})

	RenderingServer.force_draw(false)
	var image := window.get_texture().get_image()
	if image == null or image.is_empty():
		return _error(-32010, "The editor window did not return a screenshot image.")

	image.flip_y()
	var timestamp := Time.get_datetime_string_from_system(true).replace(":", "-")
	var file_path := dir_path.path_join("%s-%s.png" % [kind, timestamp])
	var save_error := image.save_png(file_path)
	if save_error != OK:
		return _error(-32010, "Failed to save the screenshot.", {"error": save_error})

	return _ok(
		{
			"kind": kind,
			"path": file_path,
			"width": image.get_width(),
			"height": image.get_height(),
			"includeImage": bool(params.get("includeImage", true))
		}
	)


func _can_capture_screenshots() -> bool:
	return DisplayServer.get_name() != "headless"


func _get_runtime_state() -> Dictionary:
	if _runtime_state_provider.is_valid():
		var runtime_state: Variant = _runtime_state_provider.call()
		if typeof(runtime_state) == TYPE_DICTIONARY:
			return runtime_state
	return {
		"isPlayingScene": false,
		"playingScenePath": "",
		"runtimeMode": ""
	}


func _flatten_output(output: Array) -> String:
	var lines := PackedStringArray()
	for entry in output:
		if typeof(entry) == TYPE_STRING:
			lines.append(str(entry))
		elif typeof(entry) == TYPE_ARRAY:
			for nested_entry in entry:
				lines.append(str(nested_entry))
		else:
			lines.append(str(entry))
	return "\n".join(lines)


func _to_string_array(values: Variant) -> Array[String]:
	var result: Array[String] = []
	if typeof(values) != TYPE_ARRAY and typeof(values) != TYPE_PACKED_STRING_ARRAY:
		return result
	for value in values:
		result.append(str(value))
	return result


func _ok(result: Variant) -> Dictionary:
	return {
		"handled": true,
		"result": result
	}


func _error(code: int, message: String, data: Variant = null) -> Dictionary:
	var error := {
		"code": code,
		"message": message
	}
	if data != null:
		error["data"] = data
	return {
		"handled": true,
		"error": error
	}
