@tool
extends RefCounted

const EditorConsoleCapture = preload("res://addons/godot_loop_mcp/observation/editor_console_capture.gd")

var _editor_interface: EditorInterface
var _workspace_root := ""
var _console_capture


func _init(editor_interface: EditorInterface, workspace_root: String) -> void:
	_editor_interface = editor_interface
	_workspace_root = workspace_root
	_console_capture = EditorConsoleCapture.new()


func dispose() -> void:
	if _console_capture != null and _console_capture.has_method("dispose"):
		_console_capture.dispose()
	_console_capture = null


func get_capability_overrides() -> Dictionary:
	if _console_capture != null and _console_capture.has_method("get_capability_overrides"):
		return _console_capture.get_capability_overrides()
	return {"editor.console.capture": "disabled"}


func get_console_capture_status() -> Dictionary:
	if _console_capture != null and _console_capture.has_method("get_status_payload"):
		return _console_capture.get_status_payload()
	return {
		"supported": false,
		"enabled": false,
		"reason": "Console capture service is unavailable."
	}


func handle_request(method: String, params: Variant = {}) -> Dictionary:
	var request_params := {}
	if typeof(params) == TYPE_DICTIONARY:
		request_params = params

	match method:
		"godot.project.get_info":
			return _ok(_build_project_info())
		"godot.editor.get_state":
			return _ok(_build_editor_state())
		"godot.scene.get_tree":
			return _ok(_build_scene_tree(request_params))
		"godot.scene.find_nodes":
			return _find_nodes(request_params)
		"godot.script.get_open_scripts":
			return _ok(_build_open_scripts_payload())
		"godot.script.view":
			return _view_script(request_params)
		"godot.logs.get_output":
			return _get_output_logs(request_params)
		"godot.logs.get_errors":
			return _get_error_logs(request_params)
		_:
			return {"handled": false}


func _build_project_info() -> Dictionary:
	return {
		"projectName": str(ProjectSettings.get_setting("application/config/name", "godot-loop-mcp")),
		"workspaceRoot": _workspace_root,
		"mainScenePath": str(ProjectSettings.get_setting("application/run/main_scene", "")),
		"godotVersion": _format_godot_version(),
		"openScenePaths": _to_string_array(_editor_interface.get_open_scenes()),
		"currentScenePath": _get_current_scene_path(),
		"hasCurrentScene": _editor_interface.get_edited_scene_root() != null
	}


func _build_editor_state() -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	var current_script := _get_current_script()
	var playing_scene_path := str(_editor_interface.get_playing_scene())
	return {
		"workspaceRoot": _workspace_root,
		"currentScenePath": _get_current_scene_path(),
		"currentSceneRootName": scene_root.name if scene_root != null else "",
		"openScenePaths": _to_string_array(_editor_interface.get_open_scenes()),
		"playingScenePath": playing_scene_path,
		"isPlayingScene": playing_scene_path != "",
		"selectedNodePaths": _get_selected_node_paths(),
		"currentScriptPath": _get_script_path(current_script),
		"openScriptPaths": _get_open_script_paths()
	}


func _build_scene_tree(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	var max_depth := int(params.get("maxDepth", -1))
	if scene_root == null:
		return {
			"sceneAvailable": false,
			"scenePath": "",
			"root": null
		}

	return {
		"sceneAvailable": true,
		"scenePath": _get_current_scene_path(),
		"root": _serialize_node(scene_root, max_depth, 0)
	}


func _find_nodes(params: Dictionary) -> Dictionary:
	var query := str(params.get("query", "")).strip_edges()
	if query == "":
		return _error(-32602, "query is required.")

	var max_results := int(params.get("maxResults", 20))
	var search_mode := str(params.get("searchMode", "contains"))
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _ok(
			{
				"query": query,
				"searchMode": search_mode,
				"matches": []
			}
		)

	var matches: Array[Dictionary] = []
	_collect_matching_nodes(scene_root, query, search_mode, max_results, matches)
	return _ok(
		{
			"query": query,
			"searchMode": search_mode,
			"matches": matches
		}
	)


func _build_open_scripts_payload() -> Dictionary:
	var current_script := _get_current_script()
	var scripts: Array[Dictionary] = []
	for script in _get_open_scripts():
		scripts.append(_build_script_summary(script, current_script))

	return {
		"currentScriptPath": _get_script_path(current_script),
		"scripts": scripts
	}


func _view_script(params: Dictionary) -> Dictionary:
	var requested_path := str(params.get("path", "")).strip_edges()
	var current_script := _get_current_script()
	var target_script: Script = current_script

	if requested_path != "":
		target_script = _find_open_script_by_path(requested_path)
		if target_script == null and ResourceLoader.exists(requested_path, "Script"):
			var loaded := ResourceLoader.load(requested_path, "Script")
			if loaded is Script:
				target_script = loaded

	if target_script == null:
		return _error(-32004, "No script is available for inspection.", {"path": requested_path})

	var source_code := target_script.source_code
	return _ok(
		{
			"path": _get_script_path(target_script),
			"isCurrent": target_script == current_script,
			"isOpen": _find_open_script_by_path(_get_script_path(target_script)) != null,
			"lineCount": _count_lines(source_code),
			"source": source_code
		}
	)


func _get_output_logs(params: Dictionary) -> Dictionary:
	if not _is_console_capture_enabled():
		return _error(-32005, "Editor console capture is unavailable.", get_console_capture_status())

	return _ok(_console_capture.get_output_payload(int(params.get("limit", 100))))


func _get_error_logs(params: Dictionary) -> Dictionary:
	if not _is_console_capture_enabled():
		return _error(-32005, "Editor console capture is unavailable.", get_console_capture_status())

	return _ok(_console_capture.get_error_payload(int(params.get("limit", 100))))


func _serialize_node(node: Node, max_depth: int, depth: int) -> Dictionary:
	var child_nodes: Array[Dictionary] = []
	if max_depth < 0 or depth < max_depth:
		for child in node.get_children():
			if child is Node:
				child_nodes.append(_serialize_node(child, max_depth, depth + 1))

	var script_path := ""
	var script_value: Variant = node.get_script()
	if script_value is Script:
		script_path = str(script_value.resource_path)

	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"ownerPath": str(node.owner.get_path()) if node.owner != null else "",
		"scriptPath": script_path,
		"childCount": node.get_child_count(),
		"children": child_nodes
	}


func _collect_matching_nodes(
	node: Node,
	query: String,
	search_mode: String,
	max_results: int,
	matches: Array[Dictionary]
) -> void:
	if matches.size() >= max_results:
		return

	if _matches_query(node.name, query, search_mode):
		matches.append(
			{
				"name": node.name,
				"type": node.get_class(),
				"path": str(node.get_path())
			}
		)
		if matches.size() >= max_results:
			return

	for child in node.get_children():
		if child is Node:
			_collect_matching_nodes(child, query, search_mode, max_results, matches)
			if matches.size() >= max_results:
				return


func _matches_query(candidate: String, query: String, search_mode: String) -> bool:
	match search_mode:
		"exact":
			return candidate == query
		"prefix":
			return candidate.begins_with(query)
		_:
			return candidate.containsn(query)


func _get_selected_node_paths() -> Array[String]:
	var selected_paths: Array[String] = []
	var selection := _editor_interface.get_selection()
	if selection == null:
		return selected_paths

	for selected_node in selection.get_selected_nodes():
		if selected_node is Node:
			selected_paths.append(str(selected_node.get_path()))
	return selected_paths


func _get_open_script_paths() -> Array[String]:
	var paths: Array[String] = []
	for script in _get_open_scripts():
		paths.append(_get_script_path(script))
	return paths


func _get_open_scripts() -> Array[Script]:
	var scripts: Array[Script] = []
	var script_editor := _editor_interface.get_script_editor()
	if script_editor == null:
		return scripts

	for script in script_editor.get_open_scripts():
		if script is Script:
			scripts.append(script)
	return scripts


func _get_current_script() -> Script:
	var script_editor := _editor_interface.get_script_editor()
	if script_editor == null:
		return null

	var current_script := script_editor.get_current_script()
	if current_script is Script:
		return current_script
	return null


func _find_open_script_by_path(script_path: String) -> Script:
	for script in _get_open_scripts():
		if _get_script_path(script) == script_path:
			return script
	return null


func _build_script_summary(script: Script, current_script: Script) -> Dictionary:
	var source_code := script.source_code
	return {
		"path": _get_script_path(script),
		"isCurrent": script == current_script,
		"lineCount": _count_lines(source_code)
	}


func _get_current_scene_path() -> String:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return ""
	return str(scene_root.scene_file_path)


func _get_script_path(script: Script) -> String:
	if script == null:
		return ""
	return str(script.resource_path)


func _count_lines(content: String) -> int:
	if content == "":
		return 0
	return content.count("\n") + 1


func _format_godot_version() -> String:
	var version_info := Engine.get_version_info()
	return "%s.%s.%s" % [
		version_info.get("major", 4),
		version_info.get("minor", 4),
		version_info.get("patch", 0)
	]


func _to_string_array(values: Variant) -> Array[String]:
	var result: Array[String] = []
	if typeof(values) != TYPE_PACKED_STRING_ARRAY and typeof(values) != TYPE_ARRAY:
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


func _is_console_capture_enabled() -> bool:
	var status := get_console_capture_status()
	return bool(status.get("enabled", false))
