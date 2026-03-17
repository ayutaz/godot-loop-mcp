extends Node

const MESSAGE_PREFIX := "godot_loop_mcp"
const CMD_PREFIX := "godot_loop_mcp_cmd"


func _ready() -> void:
	if not EngineDebugger.is_active():
		return

	if not EngineDebugger.register_message_capture(CMD_PREFIX, _on_editor_command):
		push_warning("[godot-loop-mcp] Failed to register message capture for '%s'" % CMD_PREFIX)

	get_tree().node_added.connect(_on_node_added)
	get_tree().node_removed.connect(_on_node_removed)
	call_deferred("_emit_ready")


func _exit_tree() -> void:
	if EngineDebugger.is_active():
		_send_event(
			"shutdown",
			{
				"currentScenePath": _get_current_scene_path(),
				"nodeCount": get_tree().get_node_count()
			}
		)


func _emit_ready() -> void:
	_send_event(
		"ready",
		{
			"currentScenePath": _get_current_scene_path(),
			"nodeCount": get_tree().get_node_count()
		}
	)


func _on_node_added(node: Node) -> void:
	if node == self:
		return
	_send_event(
		"node_added",
		{
			"path": str(node.get_path()),
			"name": node.name,
			"type": node.get_class()
		}
	)


func _on_node_removed(node: Node) -> void:
	if node == self:
		return
	_send_event(
		"node_removed",
		{
			"name": node.name,
			"type": node.get_class()
		}
	)


func _send_event(event_name: String, payload: Dictionary) -> void:
	if not EngineDebugger.is_active():
		return
	EngineDebugger.send_message("%s:%s" % [MESSAGE_PREFIX, event_name], [payload])


func _get_current_scene_path() -> String:
	var current_scene := get_tree().current_scene
	if current_scene == null:
		return ""
	return str(current_scene.scene_file_path)


# ---------------------------------------------------------------------------
# Editor → Game command handling
# ---------------------------------------------------------------------------

func _on_editor_command(message: String, data: Array) -> bool:
	if message == CMD_PREFIX + ":pause":
		_handle_pause_command(data)
	elif message == CMD_PREFIX + ":simulate_mouse":
		_handle_simulate_mouse_command(data)
	elif message == CMD_PREFIX + ":enumerate_controls":
		_handle_enumerate_controls_command(data)
	return true


func _handle_pause_command(data: Array) -> void:
	var paused: bool = data[0] if data.size() > 0 else true
	get_tree().paused = paused
	_send_event("pause_result", {"paused": get_tree().paused})


func _handle_simulate_mouse_command(data: Array) -> void:
	var params: Dictionary = data[0] if data.size() > 0 else {}
	var action: String = params.get("action", "click")
	var x: float = params.get("x", 0.0)
	var y: float = params.get("y", 0.0)
	var end_x: float = params.get("endX", x)
	var end_y: float = params.get("endY", y)
	var duration_ms: float = params.get("durationMs", 500.0)
	var button_str: String = params.get("button", "left")
	var btn_index: MouseButton = _parse_button(button_str)

	match action:
		"click":
			var press_event := InputEventMouseButton.new()
			press_event.position = Vector2(x, y)
			press_event.button_index = btn_index
			press_event.pressed = true
			Input.parse_input_event(press_event)

			var release_event: InputEventMouseButton = press_event.duplicate()
			release_event.pressed = false
			Input.parse_input_event(release_event)

		"drag":
			var press_event := InputEventMouseButton.new()
			press_event.position = Vector2(x, y)
			press_event.button_index = btn_index
			press_event.pressed = true
			Input.parse_input_event(press_event)

			var motion_event := InputEventMouseMotion.new()
			motion_event.position = Vector2(end_x, end_y)
			motion_event.relative = Vector2(end_x - x, end_y - y)
			Input.parse_input_event(motion_event)

			var release_event := InputEventMouseButton.new()
			release_event.position = Vector2(end_x, end_y)
			release_event.button_index = btn_index
			release_event.pressed = false
			Input.parse_input_event(release_event)

		"long_press":
			var press_event := InputEventMouseButton.new()
			press_event.position = Vector2(x, y)
			press_event.button_index = btn_index
			press_event.pressed = true
			Input.parse_input_event(press_event)

			_deferred_long_press_release(Vector2(x, y), btn_index, duration_ms / 1000.0)

	_send_event("mouse_result", {"action": action, "x": x, "y": y, "success": true})


func _deferred_long_press_release(pos: Vector2, btn: MouseButton, delay: float) -> void:
	await get_tree().create_timer(delay).timeout
	var release_event := InputEventMouseButton.new()
	release_event.position = pos
	release_event.button_index = btn
	release_event.pressed = false
	Input.parse_input_event(release_event)


func _handle_enumerate_controls_command(_data: Array) -> void:
	var root := get_tree().current_scene
	var controls: Array[Dictionary] = []
	if root != null:
		controls = _collect_controls(root)

	var elements: Array[Dictionary] = []
	for i in controls.size():
		var ctrl: Dictionary = controls[i]
		ctrl["label"] = _index_to_label(i)
		elements.append(ctrl)

	_send_event("controls_result", {"elements": elements, "count": elements.size()})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

func _parse_button(button_str: String) -> MouseButton:
	match button_str:
		"right":
			return MOUSE_BUTTON_RIGHT
		"middle":
			return MOUSE_BUTTON_MIDDLE
		_:
			return MOUSE_BUTTON_LEFT


func _collect_controls(node: Node) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if node is Control:
		var ctrl := node as Control
		result.append({
			"name": ctrl.name,
			"type": ctrl.get_class(),
			"global_position": {"x": ctrl.global_position.x, "y": ctrl.global_position.y},
			"size": {"width": ctrl.size.x, "height": ctrl.size.y},
			"visible": ctrl.visible,
			"mouse_filter": ctrl.mouse_filter,
		})
	for child in node.get_children():
		result.append_array(_collect_controls(child))
	return result


func _index_to_label(index: int) -> String:
	var label := ""
	var i := index
	while true:
		label = char(65 + (i % 26)) + label
		i = i / 26 - 1
		if i < 0:
			break
	return label
