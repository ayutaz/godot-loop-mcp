@tool
extends RefCounted

const BACKEND := "editor-console-buffer"
const ENTRY_SOURCE := "editor-console"
const MIN_SUPPORTED_MAJOR := 4
const MIN_SUPPORTED_MINOR := 5
const LEVEL_INFO := "INFO"
const LEVEL_WARNING := "WARNING"
const LEVEL_ERROR := "ERROR"
const ERROR_TYPE_ERROR := 0
const ERROR_TYPE_WARNING := 1
const LOGGER_SCRIPT_SOURCE := """
extends Logger

var _sink


func _init(sink) -> void:
\t_sink = sink


func _log_message(message: String, error: bool) -> void:
\t_sink.capture_message(message, error)


func _log_error(
\tfunction: String,
\tfile: String,
\tline: int,
\tcode: String,
\trationale: String,
\teditor_notify: bool,
\terror_type: int,
\tscript_backtraces: Array[ScriptBacktrace]
) -> void:
\t_sink.capture_error(function, file, line, code, rationale, editor_notify, error_type, script_backtraces)
"""

var _max_entries := 500
var _mutex := Mutex.new()
var _entries: Array[Dictionary] = []
var _logger_script: GDScript
var _logger_instance: RefCounted
var _status := {
	"supported": false,
	"enabled": false,
	"reason": "Godot 4.5+ is required for OS.add_logger()."
}


func _init(max_entries: int = 500) -> void:
	_max_entries = maxi(max_entries, 50)
	_status = _build_initial_status()
	if bool(_status.get("supported", false)):
		_start_capture()


func dispose() -> void:
	if bool(_status.get("enabled", false)) and _logger_instance != null and OS.has_method("remove_logger"):
		OS.call("remove_logger", _logger_instance)

	_logger_instance = null
	_logger_script = null
	_status["enabled"] = false
	_clear_entries()


func get_capability_overrides() -> Dictionary:
	return {
		"editor.console.capture": "enabled" if bool(_status.get("enabled", false)) else "disabled"
	}


func get_status_payload() -> Dictionary:
	var payload := _status.duplicate(true)
	payload["backend"] = BACKEND
	payload["maxEntries"] = _max_entries
	return payload


func clear_entries() -> int:
	var cleared_count := _entry_count()
	_clear_entries()
	return cleared_count


func get_output_payload(limit: int = 100) -> Dictionary:
	return _build_payload(
		_take_last(_snapshot_entries(), limit),
		"Reads editor console entries from the addon ring buffer registered via OS.add_logger()."
	)


func get_error_payload(limit: int = 100) -> Dictionary:
	var error_entries: Array[Dictionary] = []
	for entry in _snapshot_entries():
		if str(entry.get("level", "")) == LEVEL_ERROR:
			error_entries.append(entry)

	return _build_payload(
		_take_last(error_entries, limit),
		"Reads error-level editor console entries from the addon ring buffer registered via OS.add_logger()."
	)


func capture_message(message: String, error: bool) -> void:
	var sanitized_message := _sanitize_text(message)
	_append_entry(
		{
			"source": ENTRY_SOURCE,
			"timestamp": Time.get_datetime_string_from_system(true),
			"level": LEVEL_ERROR if error else LEVEL_INFO,
			"message": sanitized_message,
			"raw": sanitized_message
		}
	)


func capture_error(
	function_name: String,
	file_path: String,
	line: int,
	code: String,
	rationale: String,
	editor_notify: bool,
	error_type: int,
	script_backtraces: Array
) -> void:
	var message := _format_error_message(function_name, file_path, line, code, rationale)
	var level := LEVEL_WARNING if error_type == ERROR_TYPE_WARNING else LEVEL_ERROR
	var raw_parts: Array[String] = [_sanitize_text(message)]
	if editor_notify:
		raw_parts.append("[editor]")
	if script_backtraces.size() > 0:
		raw_parts.append("[script_backtraces=%d]" % script_backtraces.size())

	_append_entry(
		{
			"source": ENTRY_SOURCE,
			"timestamp": Time.get_datetime_string_from_system(true),
			"level": level,
			"message": message,
			"raw": " ".join(raw_parts)
		}
	)


func _start_capture() -> void:
	var logger_script := GDScript.new()
	logger_script.source_code = LOGGER_SCRIPT_SOURCE
	var compile_error := logger_script.reload()
	if compile_error != OK:
		_status["enabled"] = false
		_status["reason"] = "Failed to compile Logger bridge script. error=%s" % compile_error
		return

	var logger_instance := logger_script.new(self)
	if logger_instance == null:
		_status["enabled"] = false
		_status["reason"] = "Failed to instantiate Logger bridge script."
		return

	OS.call("add_logger", logger_instance)
	_logger_script = logger_script
	_logger_instance = logger_instance
	_status["enabled"] = true
	_status["reason"] = "Editor console capture is active."


func _build_initial_status() -> Dictionary:
	if not _supports_custom_logger():
		return {
			"supported": false,
			"enabled": false,
			"reason": "Godot 4.5+ is required for OS.add_logger()."
		}

	if not OS.has_method("add_logger") or not OS.has_method("remove_logger"):
		return {
			"supported": false,
			"enabled": false,
			"reason": "OS.add_logger()/remove_logger() is unavailable in this editor build."
		}

	return {
		"supported": true,
		"enabled": false,
		"reason": "Editor console capture is available."
	}


func _supports_custom_logger() -> bool:
	var version_info := Engine.get_version_info()
	var major := int(version_info.get("major", 4))
	var minor := int(version_info.get("minor", 4))
	return major > MIN_SUPPORTED_MAJOR or (
		major == MIN_SUPPORTED_MAJOR and minor >= MIN_SUPPORTED_MINOR
	)


func _format_error_message(
	function_name: String,
	file_path: String,
	line: int,
	code: String,
	rationale: String
) -> String:
	var summary := rationale.strip_edges()
	if summary == "":
		summary = code.strip_edges()
	if summary == "":
		summary = "Godot reported an editor error."
	summary = _sanitize_text(summary)

	var location_parts: Array[String] = []
	if file_path != "":
		if line > 0:
			location_parts.append("%s:%d" % [file_path, line])
		else:
			location_parts.append(file_path)
	if function_name != "":
		location_parts.append(function_name)

	if not location_parts.is_empty():
		summary += " [%s]" % " ".join(location_parts)
	if code != "" and code != rationale:
		summary += " code=%s" % _sanitize_text(code)
	return summary


func _build_payload(entries: Array[Dictionary], note: String) -> Dictionary:
	return {
		"note": note,
		"backend": BACKEND,
		"captureAvailable": bool(_status.get("supported", false)),
		"captureUsed": bool(_status.get("enabled", false)),
		"entries": entries
	}


func _append_entry(entry: Dictionary) -> void:
	_mutex.lock()
	_entries.append(entry)
	while _entries.size() > _max_entries:
		_entries.remove_at(0)
	_mutex.unlock()


func _snapshot_entries() -> Array[Dictionary]:
	_mutex.lock()
	var snapshot: Array[Dictionary] = []
	for entry in _entries:
		snapshot.append(entry.duplicate(true))
	_mutex.unlock()
	return snapshot


func _take_last(entries: Array[Dictionary], limit: int) -> Array[Dictionary]:
	var clamped_limit := maxi(limit, 1)
	var start := maxi(entries.size() - clamped_limit, 0)
	var tail: Array[Dictionary] = []
	for index in range(start, entries.size()):
		tail.append(entries[index])
	return tail


func _clear_entries() -> void:
	_mutex.lock()
	_entries.clear()
	_mutex.unlock()


func _entry_count() -> int:
	_mutex.lock()
	var count := _entries.size()
	_mutex.unlock()
	return count


func _sanitize_text(value: String) -> String:
	var builder := ""
	var in_escape_sequence := false
	for index in value.length():
		var code := value.unicode_at(index)
		if in_escape_sequence:
			if code >= 64 and code <= 126:
				in_escape_sequence = false
			continue

		if code == 27:
			in_escape_sequence = true
			continue

		if code < 32 or code == 127:
			if not builder.ends_with(" "):
				builder += " "
			continue

		builder += char(code)

	return builder.strip_edges()
