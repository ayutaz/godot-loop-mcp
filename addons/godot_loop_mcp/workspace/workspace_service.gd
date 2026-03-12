@tool
extends RefCounted

const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")
const SCENE_EXTENSION := "tscn"
const SCRIPT_EXTENSION := "gd"
const DEFAULT_SCENE_ROOT_TYPE := "Node2D"
const DEFAULT_SCRIPT_BASE_TYPE := "Node"
const RUNTIME_LOG_RESOURCE_PATH := "res://.godot/mcp/runtime.log"

var _editor_interface: EditorInterface
var _workspace_root := ""
var _runtime_pid := -1
var _runtime_scene_path := ""
var _runtime_log_path := ""


func _init(editor_interface: EditorInterface, workspace_root: String) -> void:
	_editor_interface = editor_interface
	_workspace_root = workspace_root
	_runtime_log_path = ProjectSettings.globalize_path(RUNTIME_LOG_RESOURCE_PATH)


func dispose() -> void:
	if _runtime_pid > 0:
		OS.kill(_runtime_pid)
	_runtime_pid = -1
	_runtime_scene_path = ""


func poll(_delta: float) -> void:
	if _runtime_pid > 0 and not OS.is_process_running(_runtime_pid):
		_runtime_pid = -1
		_runtime_scene_path = ""


func get_runtime_state() -> Dictionary:
	if _runtime_pid > 0 and not OS.is_process_running(_runtime_pid):
		_runtime_pid = -1
		_runtime_scene_path = ""

	return {
		"isPlayingScene": _runtime_pid > 0,
		"playingScenePath": _runtime_scene_path,
		"runtimeLogPath": _runtime_log_path,
		"runtimeMode": "external-process" if _runtime_pid > 0 else ""
	}


func handle_request(method: String, params: Variant = {}) -> Dictionary:
	var request_params := {}
	if typeof(params) == TYPE_DICTIONARY:
		request_params = params

	if not PluginSettings.is_security_level_at_least("WorkspaceWrite"):
		return _error(-32010, "%s requires WorkspaceWrite security." % method)

	match method:
		"godot.scene.create":
			return _create_scene(request_params)
		"godot.scene.open":
			return _open_scene(request_params)
		"godot.scene.save":
			return _save_scene(request_params)
		"godot.scene.play":
			return _play_scene(request_params)
		"godot.scene.stop":
			return _stop_scene()
		"godot.scene.add_node":
			return _add_node(request_params)
		"godot.scene.move_node":
			return _move_node(request_params)
		"godot.scene.delete_node":
			return _delete_node(request_params)
		"godot.scene.update_property":
			return _update_property(request_params)
		"godot.script.create":
			return _create_script(request_params)
		"godot.script.attach":
			return _attach_script(request_params)
		_:
			return {"handled": false}


func _create_scene(params: Dictionary) -> Dictionary:
	var scene_path_result := _require_resource_path(params, "path", SCENE_EXTENSION)
	if not bool(scene_path_result.get("ok", false)):
		return scene_path_result.get("error", _error(-32602, "path is required."))
	var scene_path := str(scene_path_result.get("path", ""))

	var root_type := str(params.get("rootType", DEFAULT_SCENE_ROOT_TYPE)).strip_edges()
	var root_node := _instantiate_node(root_type)
	if root_node == null:
		return _error(-32602, "rootType must be an instantiable Node class.", {"rootType": root_type})

	var root_name := str(params.get("rootName", "")).strip_edges()
	root_node.name = root_name if root_name != "" else _default_root_name(scene_path)
	var root_name_value := root_node.name

	var packed_scene := PackedScene.new()
	var pack_error := packed_scene.pack(root_node)
	if pack_error != OK:
		root_node.free()
		return _error(-32010, "Failed to pack the new scene.", {"error": pack_error})

	var dir_error := _ensure_parent_dir(scene_path)
	if dir_error != OK:
		root_node.free()
		return _error(-32010, "Failed to create the scene directory.", {"error": dir_error})

	var save_error := ResourceSaver.save(packed_scene, scene_path)
	root_node.free()
	if save_error != OK:
		return _error(
			-32010,
			"Failed to save the new scene.",
			{"path": scene_path, "error": save_error}
		)

	_notify_filesystem_file_changed(scene_path)
	_editor_interface.open_scene_from_path(scene_path)
	return _ok(
		{
			"scenePath": scene_path,
			"rootName": root_name_value,
			"rootType": root_type,
			"opened": true
		}
	)


func _open_scene(params: Dictionary) -> Dictionary:
	var scene_path_result := _require_resource_path(params, "path", SCENE_EXTENSION)
	if not bool(scene_path_result.get("ok", false)):
		return scene_path_result.get("error", _error(-32602, "path is required."))
	var scene_path := str(scene_path_result.get("path", ""))

	if not FileAccess.file_exists(ProjectSettings.globalize_path(scene_path)):
		return _error(-32004, "Scene file does not exist.", {"path": scene_path})

	_editor_interface.open_scene_from_path(scene_path)
	return _ok(
		{
			"scenePath": scene_path,
			"openScenePaths": _to_string_array(_editor_interface.get_open_scenes())
		}
	)


func _save_scene(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available to save.")

	var raw_requested_path := str(params.get("path", "")).strip_edges()
	var requested_path := _normalize_optional_resource_path(raw_requested_path)
	if raw_requested_path != "" and requested_path == "":
		return _error(-32602, "path must stay inside the workspace.", {"path": raw_requested_path})
	if requested_path == "":
		requested_path = _get_current_scene_path()

	if requested_path == "":
		return _error(-32602, "path is required when the current scene has not been saved yet.")

	var extension_error: Variant = _validate_extension(requested_path, SCENE_EXTENSION)
	if extension_error != null:
		return extension_error

	var dir_error := _ensure_parent_dir(requested_path)
	if dir_error != OK:
		return _error(-32010, "Failed to create the scene directory.", {"error": dir_error})

	var packed_scene := PackedScene.new()
	var pack_error := packed_scene.pack(scene_root)
	if pack_error != OK:
		return _error(-32010, "Failed to pack the current scene.", {"error": pack_error})

	var save_error := ResourceSaver.save(packed_scene, requested_path)
	if save_error != OK:
		return _error(
			-32010,
			"Failed to save the current scene.",
			{"path": requested_path, "error": save_error}
		)

	_notify_filesystem_file_changed(requested_path)
	if _get_current_scene_path() != requested_path:
		_editor_interface.open_scene_from_path(requested_path)
	return _ok(
		{
			"scenePath": requested_path,
			"currentScenePath": _get_current_scene_path()
		}
	)


func _play_scene(params: Dictionary) -> Dictionary:
	var raw_requested_path := str(params.get("path", "")).strip_edges()
	var requested_path := _normalize_optional_resource_path(raw_requested_path)
	if raw_requested_path != "" and requested_path == "":
		return _error(-32602, "path must stay inside the workspace.", {"path": raw_requested_path})
	if requested_path != "":
		var extension_error: Variant = _validate_extension(requested_path, SCENE_EXTENSION)
		if extension_error != null:
			return extension_error
		if not FileAccess.file_exists(ProjectSettings.globalize_path(requested_path)):
			return _error(-32004, "Scene file does not exist.", {"path": requested_path})

	if _is_headless_editor():
		return _play_scene_external(requested_path)

	if requested_path != "" and requested_path != _get_current_scene_path():
		_editor_interface.play_custom_scene(requested_path)
	else:
		if _editor_interface.get_edited_scene_root() == null:
			return _error(-32004, "No edited scene is available to play.")
		_editor_interface.play_current_scene()

	return _ok(
		{
			"requestedScenePath": requested_path,
			"currentScenePath": _get_current_scene_path(),
			"playingScenePath": str(_editor_interface.get_playing_scene())
		}
	)


func _stop_scene() -> Dictionary:
	if _runtime_pid > 0:
		var runtime_pid := _runtime_pid
		var runtime_scene_path := _runtime_scene_path
		var kill_error := OS.kill(_runtime_pid)
		_runtime_pid = -1
		_runtime_scene_path = ""
		if kill_error != OK:
			return _error(
				-32010,
				"Failed to stop the external runtime process.",
				{"pid": runtime_pid, "error": kill_error}
			)
		return _ok(
			{
				"wasPlaying": true,
				"playingScenePath": "",
				"runtimeScenePath": runtime_scene_path,
				"mode": "external-process"
			}
		)

	var was_playing := str(_editor_interface.get_playing_scene()) != ""
	_editor_interface.stop_playing_scene()
	return _ok(
		{
			"wasPlaying": was_playing,
			"playingScenePath": str(_editor_interface.get_playing_scene())
		}
	)


func _add_node(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var node_type := str(params.get("nodeType", "")).strip_edges()
	if node_type == "":
		return _error(-32602, "nodeType is required.")

	var parent_result := _resolve_parent_node(scene_root, str(params.get("parentPath", "")).strip_edges())
	if not bool(parent_result.get("ok", false)):
		return parent_result.get("error", _error(-32004, "parentPath could not be resolved."))
	var parent_node: Node = parent_result.get("node", scene_root)

	var new_node := _instantiate_node(node_type)
	if new_node == null:
		return _error(-32602, "nodeType must be an instantiable Node class.", {"nodeType": node_type})

	var requested_name := str(params.get("nodeName", "")).strip_edges()
	new_node.name = requested_name if requested_name != "" else node_type
	parent_node.add_child(new_node, true)

	var target_index := int(params.get("index", -1))
	if target_index >= 0:
		parent_node.move_child(new_node, mini(target_index, parent_node.get_child_count() - 1))

	_set_owner_recursive(new_node, scene_root)
	_mark_scene_dirty(new_node)
	return _ok(_build_node_payload(new_node))


func _move_node(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var node_path := str(params.get("nodePath", "")).strip_edges()
	if node_path == "":
		return _error(-32602, "nodePath is required.")

	var node := _find_node_by_reported_path(scene_root, node_path)
	if node == null:
		return _error(-32004, "nodePath could not be resolved.", {"nodePath": node_path})
	if node == scene_root:
		return _error(-32602, "The scene root cannot be moved.", {"nodePath": node_path})

	var parent_result := _resolve_parent_node(scene_root, str(params.get("newParentPath", "")).strip_edges())
	if not bool(parent_result.get("ok", false)):
		return parent_result.get("error", _error(-32004, "newParentPath could not be resolved."))
	var parent_node: Node = parent_result.get("node", scene_root)

	if parent_node == node:
		return _error(-32602, "A node cannot be parented to itself.", {"nodePath": node_path})

	node.reparent(parent_node, bool(params.get("keepGlobalTransform", true)))
	var target_index := int(params.get("index", -1))
	if target_index >= 0:
		parent_node.move_child(node, mini(target_index, parent_node.get_child_count() - 1))

	_set_owner_recursive(node, scene_root)
	_mark_scene_dirty(node)
	return _ok(_build_node_payload(node))


func _delete_node(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var node_path := str(params.get("nodePath", "")).strip_edges()
	if node_path == "":
		return _error(-32602, "nodePath is required.")

	var node := _find_node_by_reported_path(scene_root, node_path)
	if node == null:
		return _error(-32004, "nodePath could not be resolved.", {"nodePath": node_path})
	if node == scene_root:
		return _error(-32602, "The scene root cannot be deleted.", {"nodePath": node_path})

	var parent_path := str(node.get_parent().get_path()) if node.get_parent() != null else ""
	node.get_parent().remove_child(node)
	node.free()
	_mark_scene_dirty(scene_root)
	return _ok(
		{
			"deletedNodePath": node_path,
			"parentPath": parent_path
		}
	)


func _update_property(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var node_path := str(params.get("nodePath", "")).strip_edges()
	var property_path := str(params.get("propertyPath", "")).strip_edges()
	if node_path == "" or property_path == "":
		return _error(-32602, "nodePath and propertyPath are required.")

	var node := _find_node_by_reported_path(scene_root, node_path)
	if node == null:
		return _error(-32004, "nodePath could not be resolved.", {"nodePath": node_path})
	if not _has_base_property(node, property_path):
		return _error(
			-32602,
			"propertyPath is not exposed by the target node.",
			{"nodePath": node_path, "propertyPath": property_path}
		)

	node.set_indexed(NodePath(property_path), _decode_variant(params.get("value", null)))
	_mark_scene_dirty(node)
	return _ok(
		{
			"nodePath": str(node.get_path()),
			"propertyPath": property_path
		}
	)


func _create_script(params: Dictionary) -> Dictionary:
	var script_path_result := _require_resource_path(params, "path", SCRIPT_EXTENSION)
	if not bool(script_path_result.get("ok", false)):
		return script_path_result.get("error", _error(-32602, "path is required."))
	var script_path := str(script_path_result.get("path", ""))

	var base_type := str(params.get("baseType", DEFAULT_SCRIPT_BASE_TYPE)).strip_edges()
	var script_class_name := str(params.get("className", "")).strip_edges()
	var source := str(params.get("source", ""))
	if source == "":
		source = _build_default_script_source(
			base_type,
			script_class_name,
			str(params.get("readyMessage", "")).strip_edges()
		)

	var validation_error := _validate_script_source(source)
	if validation_error != "":
		return _error(
			-32602,
			"Script source failed validation.",
			{"path": script_path, "error": validation_error}
		)

	var dir_error := _ensure_parent_dir(script_path)
	if dir_error != OK:
		return _error(-32010, "Failed to create the script directory.", {"error": dir_error})

	var file := FileAccess.open(ProjectSettings.globalize_path(script_path), FileAccess.WRITE)
	if file == null:
		return _error(-32010, "Failed to open the script file for writing.", {"path": script_path})

	file.store_string(source)
	file.close()
	_notify_filesystem_file_changed(script_path)

	var script_resource: Variant = ResourceLoader.load(script_path, "Script")
	if bool(params.get("openInEditor", false)) and script_resource is Script:
		_editor_interface.edit_script(script_resource)

	return _ok(
		{
			"path": script_path,
			"lineCount": _count_lines(source),
			"baseType": base_type
		}
	)


func _attach_script(params: Dictionary) -> Dictionary:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return _error(-32004, "No edited scene is available.")

	var node_path := str(params.get("nodePath", "")).strip_edges()
	if node_path == "":
		return _error(-32602, "nodePath is required.")

	var script_path_result := _require_resource_path(params, "scriptPath", SCRIPT_EXTENSION)
	if not bool(script_path_result.get("ok", false)):
		return script_path_result.get("error", _error(-32602, "scriptPath is required."))
	var script_path := str(script_path_result.get("path", ""))

	var node := _find_node_by_reported_path(scene_root, node_path)
	if node == null:
		return _error(-32004, "nodePath could not be resolved.", {"nodePath": node_path})

	if not ResourceLoader.exists(script_path, "Script"):
		return _error(-32004, "Script file does not exist.", {"scriptPath": script_path})

	var script_resource := ResourceLoader.load(script_path, "Script")
	if not (script_resource is Script):
		return _error(-32010, "Failed to load the script resource.", {"scriptPath": script_path})

	node.set_script(script_resource)
	_mark_scene_dirty(node)
	if bool(params.get("openInEditor", false)):
		_editor_interface.edit_script(script_resource)

	return _ok(
		{
			"nodePath": str(node.get_path()),
			"scriptPath": script_path
		}
	)


func _resolve_parent_node(scene_root: Node, parent_path: String) -> Dictionary:
	if parent_path == "":
		return {"ok": true, "node": scene_root}

	var parent_node := _find_node_by_reported_path(scene_root, parent_path)
	if parent_node == null:
		return {
			"ok": false,
			"error": _error(-32004, "parentPath could not be resolved.", {"parentPath": parent_path})
		}

	return {"ok": true, "node": parent_node}


func _instantiate_node(node_type: String) -> Node:
	if not ClassDB.class_exists(node_type) or not ClassDB.can_instantiate(node_type):
		return null

	var instance := ClassDB.instantiate(node_type)
	if instance is Node:
		return instance
	return null


func _find_node_by_reported_path(current: Node, reported_path: String) -> Node:
	if reported_path == "":
		return current
	if str(current.get_path()) == reported_path or current.name == reported_path or reported_path == ".":
		return current

	for child in current.get_children():
		if child is Node:
			var resolved := _find_node_by_reported_path(child, reported_path)
			if resolved != null:
				return resolved
	return null


func _set_owner_recursive(node: Node, owner: Node) -> void:
	node.owner = owner
	for child in node.get_children():
		if child is Node:
			_set_owner_recursive(child, owner)


func _mark_scene_dirty(reference_node: Node) -> void:
	_editor_interface.mark_scene_as_unsaved()
	if reference_node != null:
		_editor_interface.edit_node(reference_node)


func _build_node_payload(node: Node) -> Dictionary:
	var script_path := ""
	var script_value: Variant = node.get_script()
	if script_value is Script:
		script_path = str(script_value.resource_path)

	return {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
		"parentPath": str(node.get_parent().get_path()) if node.get_parent() != null else "",
		"scriptPath": script_path,
		"childCount": node.get_child_count()
	}


func _require_resource_path(params: Dictionary, key: String, extension: String) -> Dictionary:
	var raw_path := str(params.get(key, "")).strip_edges()
	var normalized_path := _normalize_optional_resource_path(raw_path)
	if normalized_path == "":
		if raw_path == "":
			return {"ok": false, "error": _error(-32602, "%s is required." % key)}
		return {
			"ok": false,
			"error": _error(-32602, "%s must stay inside the workspace." % key, {"path": raw_path})
		}

	var extension_error: Variant = _validate_extension(normalized_path, extension)
	if extension_error != null:
		return {"ok": false, "error": extension_error}

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


func _validate_extension(resource_path: String, extension: String):
	if resource_path.get_extension().to_lower() == extension:
		return null
	if resource_path.get_extension() == "":
		return _error(-32602, "The path must include a .%s extension." % extension, {"path": resource_path})
	return _error(
		-32602,
		"The path has an unexpected extension.",
		{"path": resource_path, "expectedExtension": extension}
	)


func _ensure_parent_dir(resource_path: String) -> int:
	var parent_dir := ProjectSettings.globalize_path(resource_path.get_base_dir())
	if parent_dir == "":
		return OK
	return DirAccess.make_dir_recursive_absolute(parent_dir)


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


func _play_scene_external(requested_path: String) -> Dictionary:
	var scene_path := requested_path if requested_path != "" else _get_current_scene_path()
	if scene_path == "":
		return _error(-32602, "A saved scene path is required for headless play.")

	var dir_error := _ensure_parent_dir(RUNTIME_LOG_RESOURCE_PATH)
	if dir_error != OK:
		return _error(-32010, "Failed to create the runtime log directory.", {"error": dir_error})

	var runtime_log_file := FileAccess.open(_runtime_log_path, FileAccess.WRITE)
	if runtime_log_file != null:
		runtime_log_file.close()

	if _runtime_pid > 0:
		OS.kill(_runtime_pid)
		_runtime_pid = -1
		_runtime_scene_path = ""

	var arguments := PackedStringArray(
		[
			"--headless",
			"--path",
			_workspace_root,
			"--log-file",
			_runtime_log_path,
			scene_path
		]
	)
	var process_pid := OS.create_process(OS.get_executable_path(), arguments, false)
	if process_pid < 0:
		return _error(-32010, "Failed to start the external runtime process.", {"scenePath": scene_path})

	_runtime_pid = process_pid
	_runtime_scene_path = scene_path
	return _ok(
		{
			"requestedScenePath": requested_path,
			"currentScenePath": _get_current_scene_path(),
			"playingScenePath": _runtime_scene_path,
			"mode": "external-process",
			"pid": _runtime_pid,
			"runtimeLogPath": _runtime_log_path
		}
	)


func _is_headless_editor() -> bool:
	return DisplayServer.get_name() == "headless"


func _default_root_name(scene_path: String) -> String:
	var file_name := scene_path.get_file()
	if file_name.ends_with(".%s" % SCENE_EXTENSION):
		file_name = file_name.trim_suffix(".%s" % SCENE_EXTENSION)
	return file_name if file_name != "" else "Root"


func _build_default_script_source(base_type: String, script_class_name: String, ready_message: String) -> String:
	var lines := PackedStringArray()
	lines.append("extends %s" % base_type)
	if script_class_name != "":
		lines.append("class_name %s" % script_class_name)
	lines.append("")
	lines.append("func _ready() -> void:")
	if ready_message != "":
		lines.append("\tprint(\"%s\")" % _escape_gdscript_string(ready_message))
	else:
		lines.append("\tpass")
	lines.append("")
	return "\n".join(lines)


func _validate_script_source(source: String) -> String:
	var probe := GDScript.new()
	probe.source_code = source
	var reload_error := probe.reload()
	if reload_error == OK:
		return ""
	return "GDScript reload failed. error=%s" % reload_error


func _escape_gdscript_string(value: String) -> String:
	return value.replace("\\", "\\\\").replace("\"", "\\\"")


func _has_base_property(target: Object, property_path: String) -> bool:
	var base_name := property_path
	var parts := property_path.split(":", false, 1)
	if parts.size() > 0:
		base_name = str(parts[0])

	for property_info in target.get_property_list():
		if str(property_info.get("name", "")) == base_name:
			return true
	return false


func _decode_variant(value: Variant) -> Variant:
	match typeof(value):
		TYPE_ARRAY:
			var decoded_array: Array = []
			for item in value:
				decoded_array.append(_decode_variant(item))
			return decoded_array
		TYPE_DICTIONARY:
			var dictionary_value: Dictionary = value
			if not dictionary_value.has("type"):
				var decoded_dictionary := {}
				for key in dictionary_value.keys():
					decoded_dictionary[key] = _decode_variant(dictionary_value[key])
				return decoded_dictionary

			match str(dictionary_value.get("type", "")):
				"Vector2":
					return Vector2(float(dictionary_value.get("x", 0.0)), float(dictionary_value.get("y", 0.0)))
				"Vector3":
					return Vector3(
						float(dictionary_value.get("x", 0.0)),
						float(dictionary_value.get("y", 0.0)),
						float(dictionary_value.get("z", 0.0))
					)
				"Color":
					return Color(
						float(dictionary_value.get("r", 0.0)),
						float(dictionary_value.get("g", 0.0)),
						float(dictionary_value.get("b", 0.0)),
						float(dictionary_value.get("a", 1.0))
					)
				"NodePath":
					return NodePath(str(dictionary_value.get("value", "")))
				"StringName":
					return StringName(str(dictionary_value.get("value", "")))
				_:
					return dictionary_value.get("value", dictionary_value)
		_:
			return value


func _get_current_scene_path() -> String:
	var scene_root := _editor_interface.get_edited_scene_root()
	if scene_root == null:
		return ""
	return str(scene_root.scene_file_path)


func _count_lines(content: String) -> int:
	if content == "":
		return 0
	return content.count("\n") + 1


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
