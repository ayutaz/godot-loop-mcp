@tool
extends RefCounted

const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")
const TEXT_SEARCHABLE_EXTENSIONS := {
	"cfg": true,
	"cs": true,
	"gd": true,
	"gdshader": true,
	"gdextension": true,
	"ini": true,
	"json": true,
	"md": true,
	"shader": true,
	"sh": true,
	"scn": true,
	"sql": true,
	"tres": true,
	"tscn": true,
	"toml": true,
	"txt": true,
	"xml": true,
	"yml": true,
	"yaml": true
}

const TEXT_SEARCH_MAX_FILE_BYTES := 1_048_576
const MAX_SEARCH_RESULTS := 200
const MAX_RESAVE_PATHS := 100
const UID_SCAN_SKIPPED_EXTENSIONS := {
	"import": true,
	"log": true,
	"md": true,
	"tmp": true,
	"uid": true
}

var _editor_interface: EditorInterface
var _workspace_root := ""


func _init(editor_interface: EditorInterface, workspace_root: String) -> void:
	_editor_interface = editor_interface
	_workspace_root = workspace_root


func get_capability_overrides() -> Dictionary:
	var filesystem := _editor_interface.get_resource_filesystem()
	var selection := _editor_interface.get_selection()
	return {
		"project.search": "enabled" if filesystem != null else "disabled",
		"resource.uid": "enabled" if ResourceUID != null else "disabled",
		"resource.resave": "enabled" if filesystem != null else "disabled",
		"editor.selection.read": "enabled" if selection != null else "disabled",
		"editor.selection.write": "enabled" if selection != null else "disabled",
		"editor.focus": "enabled" if selection != null else "disabled"
	}


func handle_request(method: String, params: Variant = {}) -> Dictionary:
	var request_params := {}
	if typeof(params) == TYPE_DICTIONARY:
		request_params = params

	match method:
		"godot.project.search":
			return _search_project(request_params)
		"godot.resource.get_uid":
			return _get_uid(request_params)
		"godot.resource.resolve_uid":
			return _resolve_uid(request_params)
		"godot.resource.resave":
			if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
				return _error(-32010, "resave_resources requires WorkspaceWrite security.")
			return _resave_resources(request_params)
		"godot.editor.get_selection":
			return _ok(_build_selection_payload())
		"godot.editor.set_selection":
			if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
				return _error(-32010, "set_selection requires WorkspaceWrite security.")
			return _set_selection(request_params)
		"godot.editor.focus_node":
			if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
				return _error(-32010, "focus_node requires WorkspaceWrite security.")
			return _focus_node(request_params)
		"godot.scene.inspect_file":
			return _inspect_scene_file(request_params)
		"godot.scene.inspect_node_file":
			return _inspect_scene_node_file(request_params)
		"godot.script.read_file":
			return _read_script_file(request_params)
		_:
			return {"handled": false}


func _search_project(params: Dictionary) -> Dictionary:
	var query := str(params.get("query", "")).strip_edges()
	if query == "":
		return _error(-32602, "query is required.")

	var mode := str(params.get("mode", "path")).strip_edges().to_lower()
	if mode not in ["path", "type", "text"]:
		return _error(-32602, "mode must be one of path, type, or text.", {"mode": mode})

	var filesystem := _editor_interface.get_resource_filesystem()
	if filesystem == null and mode != "text":
		return _error(-32005, "EditorFileSystem is unavailable.")

	var max_results := clampi(int(params.get("maxResults", 50)), 1, MAX_SEARCH_RESULTS)
	var path_prefix := _normalize_optional_resource_path(str(params.get("pathPrefix", "")).strip_edges())
	if str(params.get("pathPrefix", "")).strip_edges() != "" and path_prefix == "":
		return _error(-32602, "pathPrefix must stay inside the workspace.", {"pathPrefix": params.get("pathPrefix")})

	var extension_filters := _normalize_extension_filters(params.get("fileExtensions", []))
	var results: Array[Dictionary] = []
	if mode == "text":
		_collect_text_search_results("res://", query, path_prefix, extension_filters, max_results, results)
	else:
		var root_directory = filesystem.get_filesystem()
		if root_directory == null:
			return _error(-32005, "EditorFileSystem root is unavailable.")
		_collect_search_results(root_directory, query, mode, path_prefix, extension_filters, max_results, results)

	return _ok(
		{
			"query": query,
			"mode": mode,
			"pathPrefix": path_prefix,
			"maxResults": max_results,
			"results": results,
			"truncated": results.size() >= max_results
		}
	)


func _get_uid(params: Dictionary) -> Dictionary:
	var path_result := _require_existing_resource_path(params, "path")
	if not bool(path_result.get("ok", false)):
		return path_result.get("error", _error(-32602, "path is required."))

	var resource_path := str(path_result.get("path", ""))
	var uid_info := _describe_uid(resource_path)
	if bool(uid_info.get("hasUid", false)) and str(uid_info.get("resolvedPath", "")) == "":
		_rescan_filesystem(_editor_interface.get_resource_filesystem())
		uid_info = _describe_uid(resource_path)
	return _ok(
		{
			"path": resource_path,
			"exists": true,
			"hasUid": bool(uid_info.get("hasUid", false)),
			"uid": str(uid_info.get("uid", "")),
			"uidId": int(uid_info.get("uidId", ResourceUID.INVALID_ID)),
			"resolvedPath": str(uid_info.get("resolvedPath", "")),
			"type": _guess_resource_type(resource_path)
		}
	)


func _resolve_uid(params: Dictionary) -> Dictionary:
	var requested_uid := str(params.get("uid", "")).strip_edges()
	var requested_uid_id := int(params.get("uidId", ResourceUID.INVALID_ID))
	if requested_uid == "" and requested_uid_id == ResourceUID.INVALID_ID:
		return _error(-32602, "uid or uidId is required.")

	if requested_uid_id == ResourceUID.INVALID_ID and requested_uid != "":
		requested_uid_id = int(ResourceUID.text_to_id(requested_uid))
	if requested_uid == "" and requested_uid_id != ResourceUID.INVALID_ID:
		requested_uid = str(ResourceUID.id_to_text(requested_uid_id))

	var resolved_path := _resolve_uid_path(requested_uid, requested_uid_id)
	var found := resolved_path != ""
	if found and requested_uid_id == ResourceUID.INVALID_ID and requested_uid != "":
		requested_uid_id = int(ResourceUID.text_to_id(requested_uid))

	return _ok(
		{
			"requestedUid": requested_uid,
			"requestedUidId": requested_uid_id,
			"found": found,
			"path": resolved_path,
			"exists": found and FileAccess.file_exists(ProjectSettings.globalize_path(resolved_path)),
			"type": _guess_resource_type(resolved_path) if found else ""
		}
	)


func _resave_resources(params: Dictionary) -> Dictionary:
	var raw_paths := params.get("paths", [])
	if typeof(raw_paths) != TYPE_ARRAY or raw_paths.is_empty():
		return _error(-32602, "paths must be a non-empty array.")
	if raw_paths.size() > MAX_RESAVE_PATHS:
		return _error(
			-32602,
			"paths exceeds the maximum supported batch size.",
			{"maxPaths": MAX_RESAVE_PATHS}
		)

	var results: Array[Dictionary] = []
	var saved_count := 0
	var failed_count := 0
	for raw_path in raw_paths:
		var normalized_path := _normalize_optional_resource_path(str(raw_path).strip_edges())
		if normalized_path == "":
			failed_count += 1
			results.append(
				{
					"path": str(raw_path),
					"ok": false,
					"error": "The path must stay inside the workspace."
				}
			)
			continue

		if not FileAccess.file_exists(ProjectSettings.globalize_path(normalized_path)):
			failed_count += 1
			results.append(
				{
					"path": normalized_path,
					"ok": false,
					"error": "The resource file does not exist."
				}
			)
			continue

		var resource := ResourceLoader.load(normalized_path, "", ResourceLoader.CACHE_MODE_REUSE)
		if resource == null:
			failed_count += 1
			results.append(
				{
					"path": normalized_path,
					"ok": false,
					"error": "ResourceLoader.load() returned null."
				}
			)
			continue

		var save_error := ResourceSaver.save(resource, normalized_path)
		if save_error != OK:
			failed_count += 1
			results.append(
				{
					"path": normalized_path,
					"ok": false,
					"error": "ResourceSaver.save() failed.",
					"saveError": save_error
				}
			)
			continue

		_notify_filesystem_file_changed(normalized_path)
		var uid_info := _describe_uid(normalized_path)
		saved_count += 1
		results.append(
			{
				"path": normalized_path,
				"ok": true,
				"uid": str(uid_info.get("uid", "")),
				"uidId": int(uid_info.get("uidId", ResourceUID.INVALID_ID)),
				"hasUid": bool(uid_info.get("hasUid", false))
			}
		)

	return _ok(
		{
			"savedCount": saved_count,
			"failedCount": failed_count,
			"results": results
		}
	)


func _set_selection(params: Dictionary) -> Dictionary:
	var selection := _editor_interface.get_selection()
	if selection == null:
		return _error(-32005, "Editor selection is unavailable.")

	var requested_scene_path := str(params.get("scenePath", "")).strip_edges()
	if requested_scene_path != "":
		var normalized_scene_path := _normalize_optional_resource_path(requested_scene_path)
		if normalized_scene_path == "":
			return _error(-32602, "scenePath must stay inside the workspace.", {"scenePath": requested_scene_path})
		if not FileAccess.file_exists(ProjectSettings.globalize_path(normalized_scene_path)):
			return _error(-32004, "scenePath does not exist.", {"scenePath": normalized_scene_path})
		if normalized_scene_path != _get_current_scene_path():
			_editor_interface.open_scene_from_path(normalized_scene_path)

	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var raw_node_paths := params.get("nodePaths", [])
	if typeof(raw_node_paths) != TYPE_ARRAY:
		return _error(-32602, "nodePaths must be an array.")

	var focus_in_inspector := bool(params.get("focusInInspector", true))
	selection.clear()

	var selected_nodes: Array[Node] = []
	var unresolved_node_paths: Array[String] = []
	for raw_path in raw_node_paths:
		var resolved_node := _find_node_by_reported_path(scene_root, str(raw_path).strip_edges())
		if resolved_node == null:
			unresolved_node_paths.append(str(raw_path))
			continue
		selection.add_node(resolved_node)
		selected_nodes.append(resolved_node)

	if focus_in_inspector and not selected_nodes.is_empty():
		_editor_interface.edit_node(selected_nodes[0])

	var payload := _build_selection_payload()
	payload["unresolvedNodePaths"] = unresolved_node_paths
	return _ok(payload)


func _focus_node(params: Dictionary) -> Dictionary:
	var node_path := str(params.get("nodePath", "")).strip_edges()
	if node_path == "":
		return _error(-32602, "nodePath is required.")

	var selection_result := _set_selection(
		{
			"scenePath": params.get("scenePath", ""),
			"nodePaths": [node_path],
			"focusInInspector": true
		}
	)
	if bool(selection_result.get("error", null) != null):
		return selection_result

	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var focused_node := _find_node_by_reported_path(scene_root, node_path)
	if focused_node == null:
		return _error(-32004, "nodePath could not be resolved.", {"nodePath": node_path})

	return _ok(
		{
			"currentScenePath": _get_current_scene_path(),
			"focusedNode": _build_node_payload(focused_node),
			"selection": _build_selection_payload()
		}
	)


func _inspect_scene_file(params: Dictionary) -> Dictionary:
	var path_result := _require_existing_resource_path(params, "path")
	if not bool(path_result.get("ok", false)):
		return path_result.get("error", _error(-32602, "path is required."))

	var scene_path := str(path_result.get("path", ""))
	var scene_resource := ResourceLoader.load(scene_path)
	if not scene_resource is PackedScene:
		return _error(-32004, "path did not resolve to a PackedScene.", {"path": scene_path})

	var instance: Node = scene_resource.instantiate()
	if instance == null:
		return _error(-32010, "Failed to instantiate the scene resource.", {"path": scene_path})

	var max_depth := int(params.get("maxDepth", -1))
	var payload := {
		"scenePath": scene_path,
		"root": _serialize_node(instance, max_depth, 0)
	}
	instance.free()
	return _ok(payload)


func _inspect_scene_node_file(params: Dictionary) -> Dictionary:
	var path_result := _require_existing_resource_path(params, "scenePath")
	if not bool(path_result.get("ok", false)):
		return path_result.get("error", _error(-32602, "scenePath is required."))

	var node_path := str(params.get("nodePath", "")).strip_edges()
	if node_path == "":
		return _error(-32602, "nodePath is required.")

	var scene_path := str(path_result.get("path", ""))
	var scene_resource := ResourceLoader.load(scene_path)
	if not scene_resource is PackedScene:
		return _error(-32004, "scenePath did not resolve to a PackedScene.", {"scenePath": scene_path})

	var instance: Node = scene_resource.instantiate()
	if instance == null:
		return _error(-32010, "Failed to instantiate the scene resource.", {"scenePath": scene_path})

	var resolved_node := _find_node_by_reported_path(instance, node_path)
	if resolved_node == null:
		instance.free()
		return _error(-32004, "nodePath could not be resolved inside the scene.", {"nodePath": node_path})

	var payload := {
		"scenePath": scene_path,
		"nodePath": node_path,
		"node": _serialize_node(resolved_node, int(params.get("maxDepth", 1)), 0)
	}
	instance.free()
	return _ok(payload)


func _read_script_file(params: Dictionary) -> Dictionary:
	var path_result := _require_existing_resource_path(params, "path")
	if not bool(path_result.get("ok", false)):
		return path_result.get("error", _error(-32602, "path is required."))

	var script_path := str(path_result.get("path", ""))
	var file := FileAccess.open(ProjectSettings.globalize_path(script_path), FileAccess.READ)
	if file == null:
		return _error(-32010, "Failed to open the script file.", {"path": script_path})

	var source := file.get_as_text()
	file.close()
	return _ok(
		{
			"path": script_path,
			"lineCount": source.count("\n") + 1 if source != "" else 0,
			"source": source
		}
	)


func _build_selection_payload() -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	var selection := _editor_interface.get_selection()
	var selected_node_paths: Array[String] = []
	var selected_nodes: Array[Dictionary] = []
	if selection != null:
		for selected_node in selection.get_selected_nodes():
			if selected_node is Node:
				selected_node_paths.append(str(selected_node.get_path()))
				selected_nodes.append(_build_node_payload(selected_node))

	return {
		"currentScenePath": _get_current_scene_path(),
		"currentSceneRootName": scene_root.name if scene_root != null else "",
		"selectedNodePaths": selected_node_paths,
		"selectedNodes": selected_nodes,
		"count": selected_node_paths.size()
	}


func _collect_search_results(
	directory,
	query: String,
	mode: String,
	path_prefix: String,
	extension_filters: Dictionary,
	max_results: int,
	results: Array[Dictionary]
) -> void:
	if directory == null or results.size() >= max_results:
		return

	for file_index in range(directory.get_file_count()):
		if results.size() >= max_results:
			return

		var resource_path := str(directory.get_file_path(file_index))
		if not _search_path_allowed(resource_path, path_prefix, extension_filters):
			continue

		var resource_type := str(directory.get_file_type(file_index))
		var entry := _build_resource_entry(resource_path, resource_type)
		var match := _search_entry(entry, query, mode)
		if not match.is_empty():
			entry["match"] = match
			results.append(entry)

	for subdir_index in range(directory.get_subdir_count()):
		if results.size() >= max_results:
			return
		_collect_search_results(
			directory.get_subdir(subdir_index),
			query,
			mode,
			path_prefix,
			extension_filters,
			max_results,
			results
		)


func _search_entry(entry: Dictionary, query: String, mode: String) -> Dictionary:
	match mode:
		"path":
			var resource_path := str(entry.get("path", ""))
			var file_name := str(entry.get("fileName", ""))
			if resource_path.containsn(query) or file_name.containsn(query):
				return {
					"field": "path",
					"value": resource_path
				}
		"type":
			var type_name := str(entry.get("type", ""))
			var extension := str(entry.get("extension", ""))
			var kind := str(entry.get("kind", ""))
			if type_name.containsn(query) or extension.containsn(query) or kind.containsn(query):
				return {
					"field": "type",
					"value": type_name
				}
		"text":
			return _search_text_entry(entry, query)
	return {}


func _search_text_entry(entry: Dictionary, query: String) -> Dictionary:
	var resource_path := str(entry.get("path", ""))
	var extension := str(entry.get("extension", ""))
	if not TEXT_SEARCHABLE_EXTENSIONS.has(extension):
		return {}

	var absolute_path := ProjectSettings.globalize_path(resource_path)
	var file := FileAccess.open(absolute_path, FileAccess.READ)
	if file == null:
		return {}
	if file.get_length() > TEXT_SEARCH_MAX_FILE_BYTES:
		file.close()
		return {
			"field": "text",
			"value": "",
			"skipped": true,
			"reason": "file_too_large"
		}

	var content := file.get_as_text()
	file.close()

	var line_number := 0
	for raw_line in content.split("\n", false):
		line_number += 1
		var line := str(raw_line)
		if line.containsn(query):
			return {
				"field": "text",
				"value": _build_snippet(line),
				"line": line_number
			}

	return {}


func _collect_text_search_results(
	resource_dir_path: String,
	query: String,
	path_prefix: String,
	extension_filters: Dictionary,
	max_results: int,
	results: Array[Dictionary]
) -> void:
	if results.size() >= max_results:
		return

	var absolute_dir_path := ProjectSettings.globalize_path(resource_dir_path)
	var directory := DirAccess.open(absolute_dir_path)
	if directory == null:
		return

	directory.list_dir_begin()
	var entry_name := directory.get_next()
	while entry_name != "":
		if entry_name in [".", ".."]:
			entry_name = directory.get_next()
			continue

		if directory.current_is_dir():
			if _should_skip_search_directory(entry_name):
				entry_name = directory.get_next()
				continue
			_collect_text_search_results(
				resource_dir_path.path_join(entry_name),
				query,
				path_prefix,
				extension_filters,
				max_results,
				results
			)
		else:
			var resource_path := resource_dir_path.path_join(entry_name)
			if _search_path_allowed(resource_path, path_prefix, extension_filters):
				var search_entry := _build_resource_entry(resource_path, _guess_resource_type(resource_path))
				var match := _search_text_entry(search_entry, query)
				if not match.is_empty():
					search_entry["match"] = match
					results.append(search_entry)
					if results.size() >= max_results:
						directory.list_dir_end()
						return
		entry_name = directory.get_next()

	directory.list_dir_end()


func _build_resource_entry(resource_path: String, resource_type: String) -> Dictionary:
	var uid_info := _describe_uid(resource_path)
	return {
		"path": resource_path,
		"fileName": resource_path.get_file(),
		"directory": resource_path.get_base_dir(),
		"extension": resource_path.get_extension().to_lower(),
		"type": resource_type if resource_type != "" else _guess_resource_type(resource_path),
		"kind": _infer_kind(resource_path, resource_type),
		"uid": str(uid_info.get("uid", "")),
		"uidId": int(uid_info.get("uidId", ResourceUID.INVALID_ID)),
		"hasUid": bool(uid_info.get("hasUid", false))
	}


func _search_path_allowed(resource_path: String, path_prefix: String, extension_filters: Dictionary) -> bool:
	if path_prefix != "" and not resource_path.begins_with(path_prefix):
		return false
	if extension_filters.is_empty():
		return true
	return extension_filters.has(resource_path.get_extension().to_lower())


func _should_skip_search_directory(directory_name: String) -> bool:
	return directory_name in [".git", ".godot", "node_modules"]


func _normalize_extension_filters(raw_filters: Variant) -> Dictionary:
	var filters := {}
	if typeof(raw_filters) != TYPE_ARRAY:
		return filters

	for raw_filter in raw_filters:
		var normalized := str(raw_filter).strip_edges().trim_prefix(".").to_lower()
		if normalized != "":
			filters[normalized] = true
	return filters


func _describe_uid(resource_path: String) -> Dictionary:
	var uid_text := str(ResourceUID.path_to_uid(resource_path))
	var uid_id := ResourceUID.INVALID_ID
	var has_uid := false
	if uid_text.begins_with("uid://") and uid_text != "uid://<invalid>":
		uid_id = int(ResourceUID.text_to_id(uid_text))
		has_uid = uid_id != ResourceUID.INVALID_ID

	return {
		"hasUid": has_uid,
		"uid": uid_text if has_uid else "",
		"uidId": uid_id,
		"resolvedPath": str(ResourceUID.get_id_path(uid_id)) if has_uid and ResourceUID.has_id(uid_id) else ""
	}


func _resolve_uid_path(requested_uid: String, requested_uid_id: int) -> String:
	var resolved_path := _resolve_uid_path_from_registry(requested_uid_id)
	if resolved_path != "":
		return resolved_path

	var filesystem := _editor_interface.get_resource_filesystem()
	_rescan_filesystem(filesystem)
	resolved_path = _resolve_uid_path_from_registry(requested_uid_id)
	if resolved_path != "":
		return resolved_path

	if requested_uid == "":
		return ""
	return _scan_workspace_for_uid("res://", requested_uid)


func _resolve_uid_path_from_registry(requested_uid_id: int) -> String:
	if requested_uid_id == ResourceUID.INVALID_ID:
		return ""
	if not ResourceUID.has_id(requested_uid_id):
		return ""
	return str(ResourceUID.get_id_path(requested_uid_id))


func _scan_workspace_for_uid(resource_dir_path: String, requested_uid: String) -> String:
	var absolute_dir_path := ProjectSettings.globalize_path(resource_dir_path)
	var directory := DirAccess.open(absolute_dir_path)
	if directory == null:
		return ""

	directory.list_dir_begin()
	var entry_name := directory.get_next()
	while entry_name != "":
		if entry_name in [".", ".."]:
			entry_name = directory.get_next()
			continue

		var candidate_path := resource_dir_path.path_join(entry_name)
		if directory.current_is_dir():
			if not _should_skip_search_directory(entry_name):
				var resolved_path := _scan_workspace_for_uid(candidate_path, requested_uid)
				if resolved_path != "":
					directory.list_dir_end()
					return resolved_path
		elif not _should_skip_uid_scan_file(candidate_path):
			if str(ResourceUID.path_to_uid(candidate_path)) == requested_uid:
				directory.list_dir_end()
				return candidate_path

		entry_name = directory.get_next()

	directory.list_dir_end()
	return ""


func _should_skip_uid_scan_file(resource_path: String) -> bool:
	var extension := resource_path.get_extension().to_lower()
	return UID_SCAN_SKIPPED_EXTENSIONS.has(extension)


func _infer_kind(resource_path: String, resource_type: String) -> String:
	var extension := resource_path.get_extension().to_lower()
	if resource_type == "PackedScene" or extension in ["tscn", "scn"]:
		return "scene"
	if resource_type.contains("Script") or extension in ["gd", "cs"]:
		return "script"
	if resource_type.ends_with("Texture2D") or extension in ["png", "jpg", "jpeg", "webp", "svg"]:
		return "asset"
	if resource_type.contains("Resource") or extension in ["tres", "res"]:
		return "resource"
	return "asset"


func _guess_resource_type(resource_path: String) -> String:
	var filesystem := _editor_interface.get_resource_filesystem()
	if filesystem != null:
		var directory = filesystem.get_filesystem_path(resource_path.get_base_dir())
		if directory != null:
			for file_index in range(directory.get_file_count()):
				if str(directory.get_file_path(file_index)) == resource_path:
					return str(directory.get_file_type(file_index))

	if ResourceLoader.exists(resource_path):
		var loaded := ResourceLoader.load(resource_path)
		if loaded != null:
			return loaded.get_class()

	return ""


func _require_existing_resource_path(params: Dictionary, key: String) -> Dictionary:
	var raw_path := str(params.get(key, "")).strip_edges()
	var normalized_path := _normalize_optional_resource_path(raw_path)
	if normalized_path == "":
		if raw_path == "":
			return {"ok": false, "error": _error(-32602, "%s is required." % key)}
		return {
			"ok": false,
			"error": _error(-32602, "%s must stay inside the workspace." % key, {"path": raw_path})
		}

	if not FileAccess.file_exists(ProjectSettings.globalize_path(normalized_path)):
		return {
			"ok": false,
			"error": _error(-32004, "%s does not exist." % key, {"path": normalized_path})
		}

	return {
		"ok": true,
		"path": normalized_path
	}


func _normalize_optional_resource_path(raw_path: String) -> String:
	if raw_path == "":
		return ""

	var normalized := raw_path.replace("\\", "/")
	if normalized.begins_with("res://"):
		return normalized
	if normalized.is_absolute_path():
		if normalized.begins_with(_workspace_root):
			return "res://" + normalized.trim_prefix(_workspace_root)
		return ""
	if normalized.begins_with("/"):
		normalized = normalized.trim_prefix("/")
	return "res://" + normalized


func _find_node_by_reported_path(current: Node, reported_path: String) -> Node:
	if reported_path == "":
		return current

	var current_paths: Array[String] = [current.name]
	if current.is_inside_tree():
		current_paths.append(str(current.get_path()))
	else:
		current_paths.append("/%s" % current.name)
		current_paths.append(".")
	if reported_path in current_paths or reported_path == ".":
		return current

	for child in current.get_children():
		if child is Node:
			var resolved := _find_node_by_reported_path(child, reported_path)
			if resolved != null:
				return resolved
	return null


func _build_node_payload(node: Node) -> Dictionary:
	var script_path := ""
	var script_value: Variant = node.get_script()
	if script_value is Script:
		script_path = str(script_value.resource_path)

	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()) if node.is_inside_tree() else "/%s" % node.name,
		"parentPath": (
			str(node.get_parent().get_path())
			if node.get_parent() != null and node.get_parent().is_inside_tree()
			else "/%s" % node.get_parent().name if node.get_parent() != null else ""
		),
		"scriptPath": script_path,
		"childCount": node.get_child_count()
	}


func _serialize_node(node: Node, max_depth: int, depth: int) -> Dictionary:
	var payload := _build_node_payload(node)
	payload["ownerPath"] = str(node.owner.get_path()) if node.owner != null else ""
	if max_depth >= 0 and depth >= max_depth:
		payload["children"] = []
		return payload

	var children: Array[Dictionary] = []
	for child in node.get_children():
		if child is Node:
			children.append(_serialize_node(child, max_depth, depth + 1))
	payload["children"] = children
	return payload


func _notify_filesystem_file_changed(resource_path: String) -> void:
	var filesystem := _editor_interface.get_resource_filesystem()
	if filesystem == null:
		return

	var directory_path := resource_path.get_base_dir()
	var directory = filesystem.get_filesystem_path(directory_path)
	if directory == null:
		_rescan_filesystem(filesystem)
		return

	filesystem.update_file(resource_path)
	if not _filesystem_directory_contains_file(directory, resource_path):
		_rescan_filesystem(filesystem)


func _filesystem_directory_contains_file(directory, resource_path: String) -> bool:
	if directory == null:
		return false

	for file_index in range(directory.get_file_count()):
		if str(directory.get_file_path(file_index)) == resource_path:
			return true
	return false


func _rescan_filesystem(filesystem) -> void:
	if filesystem == null:
		return
	if filesystem.has_method("scan_sources"):
		filesystem.scan_sources()
	elif filesystem.has_method("scan"):
		filesystem.scan()


func _build_snippet(line: String) -> String:
	var snippet := line.strip_edges()
	if snippet.length() <= 160:
		return snippet
	return snippet.substr(0, 157) + "..."


func _get_current_scene_path() -> String:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return ""
	return str(scene_root.scene_file_path)


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
