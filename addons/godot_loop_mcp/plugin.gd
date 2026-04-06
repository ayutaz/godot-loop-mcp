@tool
extends EditorPlugin

const BridgeClient = preload("res://addons/godot_loop_mcp/bridge/bridge_client.gd")
const CapabilityRegistry = preload("res://addons/godot_loop_mcp/capabilities/capability_registry.gd")
const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")
const DangerousService = preload("res://addons/godot_loop_mcp/dangerous/dangerous_service.gd")
const ObservationService = preload("res://addons/godot_loop_mcp/observation/observation_service.gd")
const ProjectService = preload("res://addons/godot_loop_mcp/project/project_service.gd")
const RuntimeDebugCapture = preload("res://addons/godot_loop_mcp/runtime/runtime_debug_capture.gd")
const RuntimeDebuggerPlugin = preload("res://addons/godot_loop_mcp/runtime/runtime_debugger_plugin.gd")
const VerificationService = preload("res://addons/godot_loop_mcp/verification/verification_service.gd")
const WorkspaceService = preload("res://addons/godot_loop_mcp/workspace/workspace_service.gd")

const SETTING_BRIDGE_HOST := "godot_loop_mcp/bridge/host"
const SETTING_BRIDGE_PORT := "godot_loop_mcp/bridge/port"
const SETTING_CONNECT_ON_START := "godot_loop_mcp/bridge/connect_on_start"
const SETTING_CONNECT_TIMEOUT_MS := "godot_loop_mcp/bridge/connect_timeout_ms"
const SETTING_HANDSHAKE_TIMEOUT_MS := "godot_loop_mcp/bridge/handshake_timeout_ms"
const SETTING_RECONNECT_INITIAL_DELAY_MS := "godot_loop_mcp/bridge/reconnect_initial_delay_ms"
const SETTING_RECONNECT_MAX_DELAY_MS := "godot_loop_mcp/bridge/reconnect_max_delay_ms"

const MENU_CONNECT := "Godot Loop MCP: Connect"
const MENU_DISCONNECT := "Godot Loop MCP: Disconnect"
const LOG_DIR := "res://.godot/mcp"
const LOG_FILE_NAME := "addon.log"

var _bridge_client: RefCounted
var _capability_registry: RefCounted
var _observation_service: RefCounted
var _project_service: RefCounted
var _workspace_service: RefCounted
var _verification_service: RefCounted
var _dangerous_service: RefCounted
var _runtime_debug_capture: RefCounted
var _runtime_debugger_plugin
var _current_state := "disconnected"


func _enter_tree() -> void:
	_register_project_settings()
	add_tool_menu_item(MENU_CONNECT, Callable(self, "_on_connect_requested"))
	add_tool_menu_item(MENU_DISCONNECT, Callable(self, "_on_disconnect_requested"))
	set_process(true)
	_append_log("info", "Plugin enabled.", {"project": _get_project_name()})
	if bool(ProjectSettings.get_setting(SETTING_CONNECT_ON_START, true)):
		_start_bridge()


func _exit_tree() -> void:
	set_process(false)
	remove_tool_menu_item(MENU_CONNECT)
	remove_tool_menu_item(MENU_DISCONNECT)
	_append_log("info", "Plugin disabled.", {"state": _current_state})
	_dispose_bridge_client()
	_dispose_observation_service()
	_dispose_project_service()
	_dispose_workspace_service()
	_dispose_verification_service()
	_dispose_dangerous_service()
	_unregister_runtime_debugger_plugin()
	_bridge_client = null
	_capability_registry = null
	_observation_service = null
	_project_service = null
	_verification_service = null
	_dangerous_service = null


func _process(delta: float) -> void:
	if _bridge_client != null:
		_bridge_client.poll(delta)
	if _workspace_service != null and _workspace_service.has_method("poll"):
		_workspace_service.poll(delta)


func _on_connect_requested() -> void:
	_start_bridge()


func _on_disconnect_requested() -> void:
	_append_log("info", "Manual bridge disconnect requested.")
	_dispose_bridge_client()


func _start_bridge() -> void:
	_dispose_bridge_client()
	_dispose_observation_service()
	_dispose_project_service()
	_dispose_workspace_service()
	_dispose_verification_service()
	_dispose_dangerous_service()
	_register_runtime_debugger_plugin()
	_observation_service = ObservationService.new(get_editor_interface(), ProjectSettings.globalize_path("res://"))
	_project_service = ProjectService.new(get_editor_interface(), ProjectSettings.globalize_path("res://"))
	_workspace_service = WorkspaceService.new(get_editor_interface(), ProjectSettings.globalize_path("res://"))
	_verification_service = VerificationService.new(
		get_editor_interface(),
		ProjectSettings.globalize_path("res://"),
		_runtime_debug_capture
	)
	_dangerous_service = DangerousService.new(get_editor_interface(), ProjectSettings.globalize_path("res://"))
	if _observation_service != null and _observation_service.has_method("set_runtime_state_provider"):
		_observation_service.set_runtime_state_provider(Callable(_workspace_service, "get_runtime_state"))
	if _verification_service != null and _verification_service.has_method("set_runtime_state_provider"):
		_verification_service.set_runtime_state_provider(Callable(_workspace_service, "get_runtime_state"))
	if _workspace_service != null and _workspace_service.has_method("set_pause_callable"):
		_workspace_service.set_pause_callable(Callable(_runtime_debugger_plugin, "send_pause"))
	if _verification_service != null and _verification_service.has_method("set_runtime_debugger_plugin"):
		_verification_service.set_runtime_debugger_plugin(_runtime_debugger_plugin)
	_capability_registry = CapabilityRegistry.new()
	_append_log("info", "Observation capabilities updated.", _observation_service.get_console_capture_status())
	_bridge_client = BridgeClient.new(
		_build_bridge_config(),
		_build_client_identity(),
		Callable(self, "_handle_bridge_request")
	)
	_bridge_client.log_emitted.connect(_on_bridge_log_emitted)
	_bridge_client.state_changed.connect(_on_bridge_state_changed)
	_bridge_client.handshake_completed.connect(_on_handshake_completed)
	_bridge_client.start()


func _dispose_bridge_client() -> void:
	if _bridge_client == null:
		return
	if _bridge_client.log_emitted.is_connected(_on_bridge_log_emitted):
		_bridge_client.log_emitted.disconnect(_on_bridge_log_emitted)
	if _bridge_client.state_changed.is_connected(_on_bridge_state_changed):
		_bridge_client.state_changed.disconnect(_on_bridge_state_changed)
	if _bridge_client.handshake_completed.is_connected(_on_handshake_completed):
		_bridge_client.handshake_completed.disconnect(_on_handshake_completed)
	_bridge_client.stop()


func _dispose_observation_service() -> void:
	if _observation_service == null:
		return
	if _observation_service.has_method("dispose"):
		_observation_service.dispose()
	_observation_service = null


func _dispose_project_service() -> void:
	if _project_service == null:
		return
	_project_service = null


func _dispose_workspace_service() -> void:
	if _workspace_service == null:
		return
	if _workspace_service.has_method("dispose"):
		_workspace_service.dispose()
	_workspace_service = null


func _dispose_verification_service() -> void:
	if _verification_service == null:
		return
	_verification_service = null


func _dispose_dangerous_service() -> void:
	if _dangerous_service == null:
		return
	_dangerous_service = null


func _handle_bridge_request(method: String, params: Variant = {}) -> Dictionary:
	if _observation_service != null:
		var observation_result: Dictionary = _observation_service.handle_request(method, params)
		if typeof(observation_result) == TYPE_DICTIONARY and bool(observation_result.get("handled", false)):
			return observation_result

	if _project_service != null:
		var project_result: Dictionary = _project_service.handle_request(method, params)
		if typeof(project_result) == TYPE_DICTIONARY and bool(project_result.get("handled", false)):
			return project_result

	if _workspace_service != null:
		var workspace_result: Dictionary = _workspace_service.handle_request(method, params)
		if typeof(workspace_result) == TYPE_DICTIONARY and bool(workspace_result.get("handled", false)):
			return workspace_result

	if _verification_service != null:
		var verification_result: Dictionary = _verification_service.handle_request(method, params)
		if typeof(verification_result) == TYPE_DICTIONARY and bool(verification_result.get("handled", false)):
			return verification_result

	if _dangerous_service != null:
		return _dangerous_service.handle_request(method, params)

	return {"handled": false}


func _on_bridge_log_emitted(level: String, message: String, context: Dictionary = {}) -> void:
	_append_log(level, message, context)


func _on_bridge_state_changed(state: String) -> void:
	_current_state = state
	_append_log("info", "Bridge state changed.", {"state": state})


func _on_handshake_completed(server_identity: Dictionary) -> void:
	var product := server_identity.get("product", {})
	_append_log(
		"info",
		"Bridge handshake completed.",
		{
			"session_id": server_identity.get("sessionId", ""),
			"server_name": product.get("name", ""),
			"server_version": product.get("version", "")
		}
	)


func _build_bridge_config() -> Dictionary:
	return {
		"host": str(ProjectSettings.get_setting(SETTING_BRIDGE_HOST, "127.0.0.1")),
		"port": int(ProjectSettings.get_setting(SETTING_BRIDGE_PORT, 6010)),
		"connect_timeout_ms": int(ProjectSettings.get_setting(SETTING_CONNECT_TIMEOUT_MS, 5000)),
		"handshake_timeout_ms": int(ProjectSettings.get_setting(SETTING_HANDSHAKE_TIMEOUT_MS, 5000)),
		"reconnect_initial_delay_ms": int(ProjectSettings.get_setting(SETTING_RECONNECT_INITIAL_DELAY_MS, 2000)),
		"reconnect_max_delay_ms": int(ProjectSettings.get_setting(SETTING_RECONNECT_MAX_DELAY_MS, 10000))
	}


func _build_client_identity() -> Dictionary:
	var reconnect_policy := {
		"initialDelayMs": int(ProjectSettings.get_setting(SETTING_RECONNECT_INITIAL_DELAY_MS, 2000)),
		"maxDelayMs": int(ProjectSettings.get_setting(SETTING_RECONNECT_MAX_DELAY_MS, 10000)),
		"connectTimeoutMs": int(ProjectSettings.get_setting(SETTING_CONNECT_TIMEOUT_MS, 5000)),
		"handshakeTimeoutMs": int(ProjectSettings.get_setting(SETTING_HANDSHAKE_TIMEOUT_MS, 5000)),
		"idleTimeoutMs": 30000
	}
	return _capability_registry.build_client_identity(
		ProjectSettings.globalize_path("res://"),
		_format_godot_version(),
		reconnect_policy,
		_build_capability_overrides()
	)


func _build_capability_overrides() -> Dictionary:
	var overrides := {}
	if _observation_service != null and _observation_service.has_method("get_capability_overrides"):
		overrides.merge(_observation_service.get_capability_overrides(), true)
	if _project_service != null and _project_service.has_method("get_capability_overrides"):
		overrides.merge(_project_service.get_capability_overrides(), true)
	if _verification_service != null and _verification_service.has_method("get_capability_overrides"):
		overrides.merge(_verification_service.get_capability_overrides(), true)
	if _dangerous_service != null and _dangerous_service.has_method("get_capability_overrides"):
		overrides.merge(_dangerous_service.get_capability_overrides(), true)
	if _runtime_debug_capture != null and _runtime_debug_capture.has_method("get_capability_overrides"):
		overrides.merge(_runtime_debug_capture.get_capability_overrides(), true)
	if not overrides.has("editor.console.capture"):
		overrides["editor.console.capture"] = "disabled"
	return overrides


func _register_project_settings() -> void:
	_register_project_setting(SETTING_BRIDGE_HOST, "127.0.0.1", TYPE_STRING, PROPERTY_HINT_NONE, "")
	_register_project_setting(SETTING_BRIDGE_PORT, 6010, TYPE_INT, PROPERTY_HINT_RANGE, "1,65535,1")
	_register_project_setting(SETTING_CONNECT_ON_START, true, TYPE_BOOL, PROPERTY_HINT_NONE, "")
	_register_project_setting(SETTING_CONNECT_TIMEOUT_MS, 5000, TYPE_INT, PROPERTY_HINT_RANGE, "1000,60000,100")
	_register_project_setting(SETTING_HANDSHAKE_TIMEOUT_MS, 5000, TYPE_INT, PROPERTY_HINT_RANGE, "1000,60000,100")
	_register_project_setting(
		SETTING_RECONNECT_INITIAL_DELAY_MS,
		2000,
		TYPE_INT,
		PROPERTY_HINT_RANGE,
		"500,30000,100"
	)
	_register_project_setting(
		SETTING_RECONNECT_MAX_DELAY_MS,
		10000,
		TYPE_INT,
		PROPERTY_HINT_RANGE,
		"1000,120000,100"
	)
	_register_project_setting(
		PluginSettings.SETTING_SECURITY_LEVEL,
		PluginSettings.DEFAULT_SECURITY_LEVEL,
		TYPE_STRING,
		PROPERTY_HINT_ENUM,
		"ReadOnly,WorkspaceWrite,Dangerous"
	)
	_register_project_setting(
		PluginSettings.SETTING_CONSOLE_LOG_LEVEL,
		PluginSettings.DEFAULT_CONSOLE_LOG_LEVEL,
		TYPE_STRING,
		PROPERTY_HINT_ENUM,
		"Debug,Info,Warn,Error,Silent"
	)
	_register_project_setting(
		PluginSettings.SETTING_FILE_LOG_LEVEL,
		PluginSettings.DEFAULT_FILE_LOG_LEVEL,
		TYPE_STRING,
		PROPERTY_HINT_ENUM,
		"Debug,Info,Warn,Error,Silent"
	)
	_register_project_setting(
		PluginSettings.SETTING_TESTS_ADAPTER,
		"Auto",
		TYPE_STRING,
		PROPERTY_HINT_ENUM,
		"Auto,Custom,GdUnit4,GUT"
	)
	_register_project_setting(PluginSettings.SETTING_TESTS_CUSTOM_COMMAND, "", TYPE_STRING, PROPERTY_HINT_NONE, "")
	_register_project_setting(PluginSettings.SETTING_TESTS_CUSTOM_ARGS_JSON, "[]", TYPE_STRING, PROPERTY_HINT_NONE, "")
	_register_project_setting(PluginSettings.SETTING_TESTS_DEFAULT_DIR, "res://test", TYPE_STRING, PROPERTY_HINT_NONE, "")
	_register_project_setting(
		PluginSettings.SETTING_DANGEROUS_ENABLE_EDITOR_SCRIPT,
		false,
		TYPE_BOOL,
		PROPERTY_HINT_NONE,
		""
	)
	_register_project_setting(
		PluginSettings.SETTING_DANGEROUS_ALLOWED_WRITE_PREFIXES,
		PackedStringArray(),
		TYPE_PACKED_STRING_ARRAY,
		PROPERTY_HINT_NONE,
		""
	)
	_register_project_setting(
		PluginSettings.SETTING_DANGEROUS_ALLOWED_SHELL_COMMANDS,
		PackedStringArray(),
		TYPE_PACKED_STRING_ARRAY,
		PROPERTY_HINT_NONE,
		""
	)


func _register_project_setting(
	setting_name: String,
	default_value: Variant,
	property_type: int,
	hint: int,
	hint_string: String
) -> void:
	if not ProjectSettings.has_setting(setting_name):
		ProjectSettings.set_setting(setting_name, default_value)
	ProjectSettings.add_property_info(
		{
			"name": setting_name,
			"type": property_type,
			"hint": hint,
			"hint_string": hint_string
		}
	)
	ProjectSettings.set_initial_value(setting_name, default_value)


func _format_godot_version() -> String:
	var version_info := Engine.get_version_info()
	return "%s.%s.%s" % [
		version_info.get("major", 4),
		version_info.get("minor", 4),
		version_info.get("patch", 0)
	]


func _get_project_name() -> String:
	return str(ProjectSettings.get_setting("application/config/name", "godot-loop-mcp"))


func _register_runtime_debugger_plugin() -> void:
	if _runtime_debugger_plugin != null:
		return
	_runtime_debug_capture = RuntimeDebugCapture.new()
	_runtime_debugger_plugin = RuntimeDebuggerPlugin.new(_runtime_debug_capture)
	add_debugger_plugin(_runtime_debugger_plugin)


func _unregister_runtime_debugger_plugin() -> void:
	if _runtime_debugger_plugin == null:
		return
	remove_debugger_plugin(_runtime_debugger_plugin)
	_runtime_debugger_plugin = null
	_runtime_debug_capture = null


func _append_log(level: String, message: String, context: Dictionary = {}) -> void:
	var normalized_level := level.to_upper()
	var payload := "[godot-loop-mcp][%s] %s" % [normalized_level, message]
	var console_log_level := PluginSettings.read_console_log_level()
	var file_log_level := PluginSettings.read_file_log_level()
	if PluginSettings.should_emit_log(level, console_log_level):
		if context.is_empty():
			print(payload)
		else:
			print("%s %s" % [payload, JSON.stringify(context)])

	if not PluginSettings.should_emit_log(level, file_log_level):
		return

	var log_dir := ProjectSettings.globalize_path(LOG_DIR)
	var dir_error := DirAccess.make_dir_recursive_absolute(log_dir)
	if dir_error != OK:
		return

	var log_path := log_dir.path_join(LOG_FILE_NAME)
	var file: FileAccess
	if FileAccess.file_exists(log_path):
		file = FileAccess.open(log_path, FileAccess.READ_WRITE)
		if file != null:
			file.seek_end()
	else:
		file = FileAccess.open(log_path, FileAccess.WRITE_READ)

	if file == null:
		return

	var line := "%s [%s] %s" % [
		Time.get_datetime_string_from_system(true),
		normalized_level,
		message
	]
	if not context.is_empty():
		line += " " + JSON.stringify(context)
	file.store_line(line)
	file.close()
