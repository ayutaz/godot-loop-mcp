@tool
extends RefCounted

const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")

const PROTOCOL_VERSION := "0.1.0"
const PLUGIN_VERSION := "0.1.3"


func build_manifest(capability_overrides: Dictionary = {}, security_level: String = "") -> Dictionary:
	var effective_security_level := security_level if security_level != "" else PluginSettings.read_security_level()
	return {
		"schemaVersion": PROTOCOL_VERSION,
		"securityLevel": effective_security_level,
		"capabilities": [
			_capability("bridge.handshake", "transport", "enabled", "Negotiates addon and server identity."),
			_capability("bridge.ping", "transport", "enabled", "Verifies bidirectional liveness."),
			_capability("project.info", "resource", "enabled", "Exposes project metadata to MCP resources."),
			_capability(
				"project.search",
				"tool",
				_capability_availability(capability_overrides, "project.search", "enabled", "ReadOnly"),
				"Searches project resources by path, type, or text."
			),
			_capability("editor.state", "tool", "enabled", "Exposes the current editor state."),
			_capability(
				"editor.selection.read",
				"tool",
				_capability_availability(capability_overrides, "editor.selection.read", "enabled", "ReadOnly"),
				"Reads the current node selection in the editor."
			),
			_capability(
				"editor.selection.write",
				"tool",
				_capability_availability(capability_overrides, "editor.selection.write", "enabled", "WorkspaceWrite"),
				"Updates the current node selection in the editor."
			),
			_capability(
				"editor.focus",
				"tool",
				_capability_availability(capability_overrides, "editor.focus", "enabled", "WorkspaceWrite"),
				"Focuses a node in the current editor selection."
			),
			_capability("scene.read", "tool", "enabled", "Exposes scene inspection and resource templates."),
			_capability(
				"scene.write",
				"tool",
				_capability_availability(capability_overrides, "scene.write", "enabled", "WorkspaceWrite"),
				"Exposes scene creation and node editing in the workspace."
			),
			_capability("script.read", "tool", "enabled", "Exposes script inspection in the editor."),
			_capability(
				"script.write",
				"tool",
				_capability_availability(capability_overrides, "script.write", "enabled", "WorkspaceWrite"),
				"Creates scripts and attaches them to scene nodes."
			),
			_capability(
				"resource.uid",
				"tool",
				_capability_availability(capability_overrides, "resource.uid", "enabled", "ReadOnly"),
				"Reads and resolves ResourceUID mappings for project assets."
			),
			_capability(
				"resource.resave",
				"tool",
				_capability_availability(capability_overrides, "resource.resave", "enabled", "WorkspaceWrite"),
				"Re-saves project resources to refresh serialized metadata."
			),
			_capability("logs.read", "tool", "enabled", "Exposes log inspection with addon/server fallback."),
			_capability(
				"logs.clear",
				"tool",
				_capability_availability(capability_overrides, "logs.clear", "enabled", "WorkspaceWrite"),
				"Clears addon-side editor console buffers and log files."
			),
			_capability(
				"editor.console.capture",
				"tool",
				_capability_availability(capability_overrides, "editor.console.capture", "disabled", "ReadOnly"),
				"Captures editor console messages through OS.add_logger() on Godot 4.5+."
			),
			_capability(
				"play.control",
				"tool",
				_capability_availability(capability_overrides, "play.control", "enabled", "WorkspaceWrite"),
				"Controls play and stop actions for the edited scene."
			),
			_capability(
				"tests.run",
				"tool",
				_capability_availability(capability_overrides, "tests.run", "disabled", "WorkspaceWrite"),
				"Runs GdUnit4, GUT, or a configured custom test adapter."
			),
			_capability(
				"screenshot.editor",
				"tool",
				_capability_availability(capability_overrides, "screenshot.editor", "disabled", "ReadOnly"),
				"Captures the current editor window as a PNG screenshot."
			),
			_capability(
				"screenshot.runtime",
				"tool",
				_capability_availability(capability_overrides, "screenshot.runtime", "disabled", "ReadOnly"),
				"Captures the current editor window while a scene is running."
			),
			_capability(
				"runtime.debug",
				"runtime",
				_capability_availability(capability_overrides, "runtime.debug", "disabled", "ReadOnly"),
				"Captures custom runtime telemetry through EditorDebuggerPlugin."
			),
			_capability(
				"danger.execute_editor_script",
				"security",
				_capability_availability(capability_overrides, "danger.execute_editor_script", "disabled", "Dangerous"),
				"Executes editor-side GDScript with explicit Dangerous opt-in."
			),
			_capability(
				"danger.filesystem_write_raw",
				"security",
				_capability_availability(capability_overrides, "danger.filesystem_write_raw", "disabled", "Dangerous"),
				"Writes raw files under an allowlisted workspace prefix."
			),
			_capability(
				"danger.os_shell",
				"security",
				_capability_availability(capability_overrides, "danger.os_shell", "disabled", "Dangerous"),
				"Executes an allowlisted shell command."
			)
		]
	}


func build_client_identity(
	workspace_root: String,
	godot_version: String,
	reconnect_policy: Dictionary,
	capability_overrides: Dictionary = {}
) -> Dictionary:
	var security_level := PluginSettings.read_security_level()
	return {
		"protocolVersion": PROTOCOL_VERSION,
		"role": "addon",
		"product": {
			"name": "godot-loop-mcp-addon",
			"version": PLUGIN_VERSION
		},
		"godot": {
			"version": godot_version,
			"editor": true
		},
		"securityLevel": security_level,
		"capabilities": build_manifest(capability_overrides, security_level),
		"workspaceRoot": workspace_root,
		"reconnectPolicy": reconnect_policy
	}


func _capability(id: String, surface: String, availability: String, description: String) -> Dictionary:
	return {
		"id": id,
		"surface": surface,
		"availability": availability,
		"description": description
	}


func _capability_availability(
	capability_overrides: Dictionary,
	capability_id: String,
	default_availability: String,
	required_security_level: String
) -> String:
	if not PluginSettings.is_security_level_at_least(required_security_level):
		return "disabled"
	return str(capability_overrides.get(capability_id, default_availability))
