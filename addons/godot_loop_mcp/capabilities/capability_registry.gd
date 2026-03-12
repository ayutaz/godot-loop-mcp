@tool
extends RefCounted

const PROTOCOL_VERSION := "0.1.0"
const PLUGIN_VERSION := "0.1.0"
const SECURITY_LEVEL := "ReadOnly"


func build_manifest() -> Dictionary:
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
				"id": "editor.state",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes the current editor state."
			},
			{
				"id": "scene.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes the current scene tree for read-only inspection."
			},
			{
				"id": "script.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes open script inspection in the editor."
			},
			{
				"id": "logs.read",
				"surface": "tool",
				"availability": "enabled",
				"description": "Exposes addon and bridge log inspection."
			},
			{
				"id": "runtime.debug",
				"surface": "runtime",
				"availability": "planned",
				"description": "Reserved for runtime telemetry after M0."
			}
		]
	}


func build_client_identity(workspace_root: String, godot_version: String, reconnect_policy: Dictionary) -> Dictionary:
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
		"capabilities": build_manifest(),
		"workspaceRoot": workspace_root,
		"reconnectPolicy": reconnect_policy
	}
