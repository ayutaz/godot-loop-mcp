@tool
extends RefCounted

const SECURITY_LEVELS := ["ReadOnly", "WorkspaceWrite", "Dangerous"]
const DEFAULT_SECURITY_LEVEL := "WorkspaceWrite"

const SETTING_SECURITY_LEVEL := "godot_loop_mcp/security/level"
const SETTING_TESTS_ADAPTER := "godot_loop_mcp/tests/adapter"
const SETTING_TESTS_CUSTOM_COMMAND := "godot_loop_mcp/tests/custom_command"
const SETTING_TESTS_CUSTOM_ARGS_JSON := "godot_loop_mcp/tests/custom_args_json"
const SETTING_TESTS_DEFAULT_DIR := "godot_loop_mcp/tests/default_dir"
const SETTING_DANGEROUS_ENABLE_EDITOR_SCRIPT := "godot_loop_mcp/dangerous/enable_editor_script"
const SETTING_DANGEROUS_ALLOWED_WRITE_PREFIXES := "godot_loop_mcp/dangerous/allowed_write_prefixes"
const SETTING_DANGEROUS_ALLOWED_SHELL_COMMANDS := "godot_loop_mcp/dangerous/allowed_shell_commands"

const ENV_SECURITY_LEVEL := "GODOT_LOOP_MCP_SECURITY_LEVEL"
const ENV_TESTS_ADAPTER := "GODOT_LOOP_MCP_TEST_ADAPTER"
const ENV_TESTS_CUSTOM_COMMAND := "GODOT_LOOP_MCP_TEST_COMMAND"
const ENV_TESTS_CUSTOM_ARGS_JSON := "GODOT_LOOP_MCP_TEST_ARGS"
const ENV_TESTS_DEFAULT_DIR := "GODOT_LOOP_MCP_TEST_DIR"
const ENV_ENABLE_EDITOR_SCRIPT := "GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT"
const ENV_ALLOWED_WRITE_PREFIXES := "GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES"
const ENV_ALLOWED_SHELL_COMMANDS := "GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS"


static func read_security_level() -> String:
	var env_value := _normalize_security_level(OS.get_environment(ENV_SECURITY_LEVEL))
	if env_value != "":
		return env_value
	return _normalize_security_level(
		str(ProjectSettings.get_setting(SETTING_SECURITY_LEVEL, DEFAULT_SECURITY_LEVEL))
	)


static func is_security_level_at_least(required_level: String) -> bool:
	var current_index := SECURITY_LEVELS.find(read_security_level())
	var required_index := SECURITY_LEVELS.find(_normalize_security_level(required_level))
	return current_index >= 0 and required_index >= 0 and current_index >= required_index


static func read_tests_adapter() -> String:
	var env_value := _normalize_adapter(OS.get_environment(ENV_TESTS_ADAPTER))
	if env_value != "":
		return env_value
	return _normalize_adapter(str(ProjectSettings.get_setting(SETTING_TESTS_ADAPTER, "Auto")))


static func read_tests_custom_command() -> String:
	var env_value := OS.get_environment(ENV_TESTS_CUSTOM_COMMAND).strip_edges()
	if env_value != "":
		return env_value
	return str(ProjectSettings.get_setting(SETTING_TESTS_CUSTOM_COMMAND, "")).strip_edges()


static func read_tests_custom_args() -> Array[String]:
	var env_value := OS.get_environment(ENV_TESTS_CUSTOM_ARGS_JSON).strip_edges()
	if env_value != "":
		return _parse_json_string_array(env_value)
	return _parse_json_string_array(
		str(ProjectSettings.get_setting(SETTING_TESTS_CUSTOM_ARGS_JSON, "[]"))
	)


static func read_tests_default_dir() -> String:
	var env_value := OS.get_environment(ENV_TESTS_DEFAULT_DIR).strip_edges()
	if env_value != "":
		return env_value
	return str(ProjectSettings.get_setting(SETTING_TESTS_DEFAULT_DIR, "res://test")).strip_edges()


static func read_enable_editor_script() -> bool:
	var env_value := OS.get_environment(ENV_ENABLE_EDITOR_SCRIPT).strip_edges()
	if env_value != "":
		return _to_bool(env_value)
	return bool(ProjectSettings.get_setting(SETTING_DANGEROUS_ENABLE_EDITOR_SCRIPT, false))


static func read_allowed_write_prefixes() -> Array[String]:
	var env_value := OS.get_environment(ENV_ALLOWED_WRITE_PREFIXES).strip_edges()
	if env_value != "":
		return _split_string_list(env_value)
	return _to_string_array(
		ProjectSettings.get_setting(
			SETTING_DANGEROUS_ALLOWED_WRITE_PREFIXES,
			PackedStringArray()
		)
	)


static func read_allowed_shell_commands() -> Array[String]:
	var env_value := OS.get_environment(ENV_ALLOWED_SHELL_COMMANDS).strip_edges()
	if env_value != "":
		return _split_string_list(env_value)
	return _to_string_array(
		ProjectSettings.get_setting(
			SETTING_DANGEROUS_ALLOWED_SHELL_COMMANDS,
			PackedStringArray()
		)
	)


static func _normalize_security_level(value: String) -> String:
	var normalized := value.strip_edges()
	for candidate in SECURITY_LEVELS:
		if candidate.to_lower() == normalized.to_lower():
			return candidate
	return DEFAULT_SECURITY_LEVEL if normalized == "" else ""


static func _normalize_adapter(value: String) -> String:
	var normalized := value.strip_edges()
	for candidate in ["Auto", "Custom", "GdUnit4", "GUT"]:
		if candidate.to_lower() == normalized.to_lower():
			return candidate
	return "Auto"


static func _parse_json_string_array(raw_value: String) -> Array[String]:
	var trimmed := raw_value.strip_edges()
	if trimmed == "":
		return []

	var parsed := JSON.parse_string(trimmed)
	if typeof(parsed) != TYPE_ARRAY:
		return []

	var result: Array[String] = []
	for entry in parsed:
		result.append(str(entry))
	return result


static func _split_string_list(raw_value: String) -> Array[String]:
	var normalized := raw_value.replace("\r", "\n").replace(";", "\n").replace(",", "\n")
	var result: Array[String] = []
	for entry in normalized.split("\n", false):
		var trimmed := str(entry).strip_edges()
		if trimmed != "":
			result.append(trimmed)
	return result


static func _to_string_array(value: Variant) -> Array[String]:
	var result: Array[String] = []
	if typeof(value) != TYPE_ARRAY and typeof(value) != TYPE_PACKED_STRING_ARRAY:
		return result

	for entry in value:
		result.append(str(entry).strip_edges())
	return result


static func _to_bool(raw_value: String) -> bool:
	var normalized := raw_value.strip_edges().to_lower()
	return normalized in ["1", "true", "yes", "on"]
