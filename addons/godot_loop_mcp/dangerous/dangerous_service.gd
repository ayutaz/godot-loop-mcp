@tool
extends RefCounted

const PluginSettings = preload("res://addons/godot_loop_mcp/config/plugin_settings.gd")

var _editor_interface: EditorInterface
var _workspace_root := ""


func _init(editor_interface: EditorInterface, workspace_root: String) -> void:
	_editor_interface = editor_interface
	_workspace_root = workspace_root


func get_capability_overrides() -> Dictionary:
	var dangerous_enabled := PluginSettings.is_security_level_at_least("Dangerous")
	var write_prefixes := PluginSettings.read_allowed_write_prefixes()
	var shell_commands := PluginSettings.read_allowed_shell_commands()
	return {
		"danger.execute_editor_script": (
			"enabled"
			if dangerous_enabled and PluginSettings.read_enable_editor_script()
			else "disabled"
		),
		"danger.filesystem_write_raw": (
			"enabled"
			if dangerous_enabled and not write_prefixes.is_empty()
			else "disabled"
		),
		"danger.os_shell": (
			"enabled"
			if dangerous_enabled and not shell_commands.is_empty()
			else "disabled"
		),
		"editor.menu.execute": (
			"enabled"
			if dangerous_enabled
			else "disabled"
		)
	}


func handle_request(method: String, params: Variant = {}) -> Dictionary:
	var request_params := {}
	if typeof(params) == TYPE_DICTIONARY:
		request_params = params

	match method:
		"godot.danger.execute_editor_script":
			return _execute_editor_script(request_params)
		"godot.danger.filesystem_write_raw":
			return _filesystem_write_raw(request_params)
		"godot.danger.os_shell":
			return _os_shell(request_params)
		"godot.editor.execute_menu_item":
			return _execute_menu_item(request_params)
		_:
			return {"handled": false}


func _execute_editor_script(params: Dictionary) -> Dictionary:
	if not PluginSettings.is_security_level_at_least("Dangerous"):
		return _error(-32010, "execute_editor_script requires Dangerous security.")
	if not PluginSettings.read_enable_editor_script():
		return _error(-32010, "execute_editor_script is not enabled.")

	var source := str(params.get("source", ""))
	if source.strip_edges() == "":
		return _error(-32602, "source is required.")

	var wrapper_lines := PackedStringArray(
		[
			"extends RefCounted",
			"func run(editor_interface: EditorInterface, workspace_root: String, args: Dictionary) -> Variant:"
		]
	)
	for line in source.split("\n", false):
		wrapper_lines.append("\t%s" % line)

	var script := GDScript.new()
	script.source_code = "\n".join(wrapper_lines)
	var reload_error := script.reload()
	if reload_error != OK:
		return _error(-32602, "The editor script failed to compile.", {"error": reload_error})

	var instance: Variant = script.new()
	if instance == null:
		return _error(-32010, "The editor script could not be instantiated.")

	var args := params.get("args", {})
	if typeof(args) != TYPE_DICTIONARY:
		args = {}
	var result: Variant = instance.run(_editor_interface, _workspace_root, args)
	return _ok(
		{
			"result": _serialize_variant(result)
		}
	)


func _filesystem_write_raw(params: Dictionary) -> Dictionary:
	if not PluginSettings.is_security_level_at_least("Dangerous"):
		return _error(-32010, "filesystem_write_raw requires Dangerous security.")

	var path_result := _require_allowed_write_path(str(params.get("path", "")).strip_edges())
	if not bool(path_result.get("ok", false)):
		return path_result.get("error", _error(-32602, "path is required."))
	var resource_path := str(path_result.get("path", ""))

	var absolute_path := ProjectSettings.globalize_path(resource_path)
	var parent_dir := absolute_path.get_base_dir()
	var dir_error := DirAccess.make_dir_recursive_absolute(parent_dir)
	if dir_error != OK:
		return _error(-32010, "Failed to create the parent directory.", {"error": dir_error})

	var overwrite := bool(params.get("overwrite", true))
	if not overwrite and FileAccess.file_exists(absolute_path):
		return _error(-32010, "The target file already exists.", {"path": resource_path})

	var content := str(params.get("content", ""))
	var file := FileAccess.open(absolute_path, FileAccess.WRITE)
	if file == null:
		return _error(-32010, "Failed to open the target file for writing.", {"path": resource_path})
	file.store_string(content)
	file.close()
	_notify_filesystem_file_changed(resource_path)

	return _ok(
		{
			"path": resource_path,
			"absolutePath": absolute_path,
			"bytesWritten": content.to_utf8_buffer().size()
		}
	)


func _os_shell(params: Dictionary) -> Dictionary:
	if not PluginSettings.is_security_level_at_least("Dangerous"):
		return _error(-32010, "os_shell requires Dangerous security.")

	var executable := str(params.get("executable", "")).strip_edges()
	if executable == "":
		return _error(-32602, "executable is required.")
	if not _is_allowed_shell_command(executable):
		return _error(-32010, "The executable is not allowlisted.", {"executable": executable})

	var raw_args := params.get("args", [])
	var output: Array = []
	var exit_code := OS.execute(
		executable,
		PackedStringArray(_to_string_array(raw_args)),
		output,
		bool(params.get("readStderr", true)),
		bool(params.get("openConsole", false))
	)
	return _ok(
		{
			"executable": executable,
			"args": _to_string_array(raw_args),
			"exitCode": exit_code,
			"output": _flatten_output(output)
		}
	)


func _execute_menu_item(params: Dictionary) -> Dictionary:
	if not PluginSettings.is_security_level_at_least("Dangerous"):
		return _error(-32010, "execute_menu_item requires Dangerous security.")

	var menu_path := str(params.get("menuPath", "")).strip_edges()
	if menu_path == "":
		return _error(-32602, "menuPath is required.")

	var base_control := _editor_interface.get_base_control()
	if base_control == null:
		return _error(-32010, "Editor base control is not available.")

	var menu_bar := _find_menu_bar(base_control)
	if menu_bar == null:
		return _error(-32010, "Editor MenuBar not found.")

	var path_parts := menu_path.split("/", false)
	if path_parts.is_empty():
		return _error(-32602, "menuPath is empty after parsing.")

	var activate_result := _find_and_activate_menu_item(menu_bar, path_parts)
	if not bool(activate_result.get("found", false)):
		return _error(
			-32004,
			str(activate_result.get("reason", "Menu item not found.")),
			{"menuPath": menu_path}
		)

	return _ok({"executed": true, "menuPath": menu_path})


func _find_menu_bar(control: Control) -> MenuBar:
	if control is MenuBar:
		return control as MenuBar

	for child_index in range(control.get_child_count()):
		var child := control.get_child(child_index)
		if child is Control:
			var found := _find_menu_bar(child as Control)
			if found != null:
				return found

	return null


func _find_and_activate_menu_item(menu_bar: MenuBar, path_parts: PackedStringArray) -> Dictionary:
	var top_menu_name := path_parts[0]
	var menu_index := -1

	for i in menu_bar.get_menu_count():
		if menu_bar.get_menu_title(i) == top_menu_name:
			menu_index = i
			break

	if menu_index < 0:
		return {"found": false, "reason": "Top-level menu '%s' not found." % top_menu_name}

	var popup := menu_bar.get_menu_popup(menu_index)
	if popup == null:
		return {"found": false, "reason": "PopupMenu for '%s' is not available." % top_menu_name}

	if path_parts.size() == 1:
		return {"found": false, "reason": "menuPath must include at least a menu item name after the top-level menu."}

	var remaining_parts := path_parts.slice(1)
	return _activate_in_popup(popup, remaining_parts)


func _activate_in_popup(popup: PopupMenu, path_parts: PackedStringArray) -> Dictionary:
	var target_label := path_parts[0]
	var is_last := path_parts.size() == 1

	for i in popup.item_count:
		var item_text := popup.get_item_text(i)
		if item_text != target_label:
			continue

		if is_last:
			if popup.is_item_disabled(i):
				return {"found": false, "reason": "Menu item '%s' is disabled." % target_label}
			if popup.is_item_separator(i):
				return {"found": false, "reason": "'%s' is a separator, not an activatable item." % target_label}
			var item_id := popup.get_item_id(i)
			popup.emit_signal("id_pressed", item_id)
			return {"found": true}

		var submenu_name := popup.get_item_submenu(i)
		if submenu_name == "":
			return {"found": false, "reason": "'%s' does not have a submenu." % target_label}

		var submenu: PopupMenu = null
		for child_index in popup.get_child_count():
			var child := popup.get_child(child_index)
			if child is PopupMenu and child.name == submenu_name:
				submenu = child as PopupMenu
				break

		if submenu == null:
			return {"found": false, "reason": "Submenu '%s' not found under '%s'." % [submenu_name, target_label]}

		return _activate_in_popup(submenu, path_parts.slice(1))

	return {"found": false, "reason": "Menu item '%s' not found." % target_label}


func _require_allowed_write_path(raw_path: String) -> Dictionary:
	if raw_path == "":
		return {"ok": false, "error": _error(-32602, "path is required.")}

	var normalized_path := _normalize_optional_resource_path(raw_path)
	if normalized_path == "":
		return {
			"ok": false,
			"error": _error(-32602, "path must stay inside the workspace.", {"path": raw_path})
		}

	for allowed_prefix in PluginSettings.read_allowed_write_prefixes():
		var normalized_prefix := _normalize_optional_resource_path(allowed_prefix)
		if normalized_prefix != "" and normalized_path.begins_with(normalized_prefix):
			return {
				"ok": true,
				"path": normalized_path
			}

	return {
		"ok": false,
		"error": _error(
			-32010,
			"path is outside the dangerous write allowlist.",
			{"path": normalized_path, "allowlist": PluginSettings.read_allowed_write_prefixes()}
		)
	}


func _is_allowed_shell_command(executable: String) -> bool:
	var normalized_executable := executable.replace("\\", "/").to_lower()
	for allowed_command in PluginSettings.read_allowed_shell_commands():
		var normalized_allowed := allowed_command.replace("\\", "/").to_lower()
		if normalized_allowed == "":
			continue
		if normalized_executable == normalized_allowed or normalized_executable.ends_with("/%s" % normalized_allowed):
			return true
	return false


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


func _notify_filesystem_file_changed(resource_path: String) -> void:
	var filesystem := _editor_interface.get_resource_filesystem()
	if filesystem == null:
		return

	var directory_path := resource_path.get_base_dir()
	var directory = filesystem.get_filesystem_path(directory_path)
	if directory == null:
		if filesystem.has_method("scan_sources"):
			filesystem.scan_sources()
		elif filesystem.has_method("scan"):
			filesystem.scan()
		return

	filesystem.update_file(resource_path)


func _flatten_output(output: Array) -> String:
	var lines := PackedStringArray()
	for entry in output:
		lines.append(str(entry))
	return "\n".join(lines)


func _serialize_variant(value: Variant) -> Variant:
	match typeof(value):
		TYPE_ARRAY:
			var encoded_array: Array = []
			for entry in value:
				encoded_array.append(_serialize_variant(entry))
			return encoded_array
		TYPE_DICTIONARY:
			var encoded_dictionary := {}
			for key in value.keys():
				encoded_dictionary[str(key)] = _serialize_variant(value[key])
			return encoded_dictionary
		TYPE_VECTOR2:
			return {"type": "Vector2", "x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_OBJECT:
			if value == null:
				return null
			return {
				"type": value.get_class(),
				"value": str(value)
			}
		_:
			return value


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
