@tool
extends RefCounted

const PROTOCOL_VERSION := "0.1.0"
const PLUGIN_VERSION := "0.1.0"
const SECURITY_LEVEL := "WorkspaceWrite"


func build_manifest(capability_overrides: Dictionary = {}) -> Dictionary:
	var editor_console_capture := str(capability_overrides.get("editor.console.capture", "disabled"))
	var project_search := str(capability_overrides.get("project.search", "enabled"))
	var resource_uid := str(capability_overrides.get("resource.uid", "enabled"))
	var resource_resave := str(capability_overrides.get("resource.resave", "enabled"))
	var editor_selection_read := str(capability_overrides.get("editor.selection.read", "enabled"))
	var editor_selection_write := str(capability_overrides.get("editor.selection.write", "enabled"))
	var editor_focus := str(capability_overrides.get("editor.focus", "enabled"))
	return {
		"schemaVersion": PROTOCOL_VERSION,
		"securityLevel": SECURITY_LEVEL,
		"capabilities": [
			{
				"id": "bridge.handshake",
				"surface": "transport",
				"availability": "enabled",
				"description": "Negotiates addon and server identity."
			},
			{
				"id": "bridge.ping",
				"surface": "transport",
				"availability": "enabled",
				"description": "Verifies bidirectional liveness."
			},
			{
				"id": "project.info",
				"surface": "resource",
				"availability": "enabled",
				"description": "Exposes project metadata to MCP resources."
			},
			{
				"id": "project.search",
				"surface": "tool",
				"availability": project_search,
				"description": "Searches project resources by path, type, or text."
			},
			{
				"id": "editor.state",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes the current editor state."
			},
			{
				"id": "editor.selection.read",
				"surface": "tool",
				"availability": editor_selection_read,
				"description": "Reads the current node selection in the editor."
			},
			{
				"id": "editor.selection.write",
				"surface": "tool",
				"availability": editor_selection_write,
				"description": "Updates the current node selection in the editor."
			},
			{
				"id": "editor.focus",
				"surface": "tool",
				"availability": editor_focus,
				"description": "Focuses a node in the current editor selection."
			},
			{
				"id": "scene.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes the current scene tree for read-only inspection."
			},
			{
				"id": "scene.write",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes scene creation and node editing in the workspace."
			},
			{
				"id": "script.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes open script inspection in the editor."
			},
			{
				"id": "script.write",
				"surface": "tool",
				"availability": "enabled",
				"description": "Creates scripts and attaches them to scene nodes."
			},
			{
				"id": "resource.uid",
				"surface": "tool",
				"availability": resource_uid,
				"description": "Reads and resolves ResourceUID mappings for project assets."
			},
			{
				"id": "resource.resave",
				"surface": "tool",
				"availability": resource_resave,
				"description": "Re-saves project resources to refresh serialized metadata."
			},
			{
				"id": "logs.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes log inspection with addon/server fallback."
			},
			{
				"id": "logs.clear",
				"surface": "tool",
				"availability": "enabled",
				"description": "Clears addon-side editor console buffers and log files."
			},
			{
				"id": "editor.console.capture",
				"surface": "tool",
				"availability": editor_console_capture,
				"description": "Captures editor console messages through OS.add_logger() on Godot 4.5+."
			},
			{
				"id": "play.control",
				"surface": "tool",
				"availability": "enabled",
				"description": "Controls play and stop actions for the edited scene."
			},
			{
				"id": "runtime.debug",
				"surface": "runtime",
				"availability": "planned",
				"description": "Reserved for runtime telemetry after M0."
			}
		]
	}


func build_client_identity(
	workspace_root: String,
	godot_version: String,
	reconnect_policy: Dictionary,
	capability_overrides: Dictionary = {}
) -> Dictionary:
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
		"securityLevel": SECURITY_LEVEL,
		"capabilities": build_manifest(capability_overrides),
		"workspaceRoot": workspace_root,
		"reconnectPolicy": reconnect_policy
	}
