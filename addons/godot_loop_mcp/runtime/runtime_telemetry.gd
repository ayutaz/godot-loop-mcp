extends Node

const MESSAGE_PREFIX := "godot_loop_mcp"
const CMD_PREFIX := "godot_loop_mcp_cmd"
const DEFAULT_SNAPSHOT_INTERVAL_SEC := 0.5
const SNAPSHOT_INTERVAL_SETTING := "godot_loop_mcp/runtime/snapshot_interval_sec"
const DEFAULT_IDLE_SNAPSHOT_INTERVAL_SEC := 1.0
const IDLE_SNAPSHOT_INTERVAL_SETTING := "godot_loop_mcp/runtime/idle_snapshot_interval_sec"
const STABLE_POLL_THRESHOLD := 4
const TRACKED_PROPERTY_NAMES := [
	"text",
	"disabled",
	"button_pressed",
	"value",
	"selected",
	"visible",
	"playing",
	"stream_paused",
	"bus",
	"volume_db",
	"autoplay"
]

var _snapshot_elapsed := 0.0
var _snapshot_interval_sec := DEFAULT_SNAPSHOT_INTERVAL_SEC
var _idle_snapshot_interval_sec := DEFAULT_IDLE_SNAPSHOT_INTERVAL_SEC
var _unchanged_poll_count := 0
var _last_runtime_snapshot_hash := ""
var _last_audio_snapshot_hash := ""
var _property_presence_cache := {}


func _ready() -> void:
	if not EngineDebugger.is_active():
		return

	_snapshot_interval_sec = maxf(
		float(ProjectSettings.get_setting(SNAPSHOT_INTERVAL_SETTING, DEFAULT_SNAPSHOT_INTERVAL_SEC)),
		0.05
	)
	_idle_snapshot_interval_sec = maxf(
		float(ProjectSettings.get_setting(IDLE_SNAPSHOT_INTERVAL_SETTING, DEFAULT_IDLE_SNAPSHOT_INTERVAL_SEC)),
		_snapshot_interval_sec
	)
	var capture_registration: Variant = EngineDebugger.call("register_message_capture", CMD_PREFIX, _on_editor_command)
	if typeof(capture_registration) == TYPE_BOOL and not bool(capture_registration):
		push_warning("Failed to register debugger message capture for '%s'; editor commands may be unavailable." % CMD_PREFIX)

	get_tree().node_added.connect(_on_node_added)
	get_tree().node_removed.connect(_on_node_removed)
	set_process(true)
	call_deferred("_emit_ready")


func _process(delta: float) -> void:
	if not EngineDebugger.is_active():
		return

	_snapshot_elapsed += delta
	if _snapshot_elapsed < _get_current_snapshot_interval_sec():
		return

	_snapshot_elapsed = 0.0
	var runtime_changed := _emit_runtime_snapshot_if_changed("poll")
	var audio_changed := _emit_audio_snapshot_if_changed("poll")
	if runtime_changed or audio_changed:
		_unchanged_poll_count = 0
	else:
		_unchanged_poll_count = min(_unchanged_poll_count + 1, STABLE_POLL_THRESHOLD)


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
	_reset_poll_backoff()
	_send_event(
		"ready",
		{
			"currentScenePath": _get_current_scene_path(),
			"nodeCount": get_tree().get_node_count()
		}
	)
	_emit_runtime_snapshot_if_changed("ready")
	_emit_audio_snapshot_if_changed("ready")


func _on_node_added(node: Node) -> void:
	if node == self:
		return
	_reset_poll_backoff()
	_send_event(
		"node_added",
		{
			"path": str(node.get_path()),
			"name": node.name,
			"type": node.get_class()
		}
	)
	call_deferred("_emit_runtime_snapshot_if_changed", "node_added")
	call_deferred("_emit_audio_snapshot_if_changed", "node_added")


func _on_node_removed(node: Node) -> void:
	if node == self:
		return
	_reset_poll_backoff()
	_send_event(
		"node_removed",
		{
			"name": node.name,
			"type": node.get_class()
		}
	)
	call_deferred("_emit_runtime_snapshot_if_changed", "node_removed")
	call_deferred("_emit_audio_snapshot_if_changed", "node_removed")


func _emit_runtime_snapshot_if_changed(reason: String) -> bool:
	var payload := _build_runtime_snapshot(reason)
	var serialized := JSON.stringify(
		{
			"currentScenePath": payload.get("currentScenePath", ""),
			"rootPath": payload.get("rootPath", ""),
			"nodeCount": payload.get("nodeCount", 0),
			"nodes": payload.get("nodes", [])
		}
	)
	if serialized == _last_runtime_snapshot_hash:
		return false

	_last_runtime_snapshot_hash = serialized
	_send_event("runtime_snapshot", payload)
	return true


func _emit_audio_snapshot_if_changed(reason: String) -> bool:
	var payload := _build_audio_snapshot(reason)
	var serialized := JSON.stringify(
		{
			"currentScenePath": payload.get("currentScenePath", ""),
			"playerCount": payload.get("playerCount", 0),
			"activePlayerCount": payload.get("activePlayerCount", 0),
			"players": payload.get("players", [])
		}
	)
	if serialized == _last_audio_snapshot_hash:
		return false

	_last_audio_snapshot_hash = serialized
	_send_event("audio_players_snapshot", payload)
	return true


func _build_runtime_snapshot(reason: String) -> Dictionary:
	var root := get_tree().current_scene
	var nodes: Array[Dictionary] = []
	if root != null:
		_collect_runtime_nodes(root, "", nodes)

	return {
		"reason": reason,
		"capturedAt": Time.get_datetime_string_from_system(true),
		"currentScenePath": _get_current_scene_path(),
		"rootPath": str(root.get_path()) if root != null else "",
		"nodeCount": nodes.size(),
		"nodes": nodes
	}


func _build_audio_snapshot(reason: String) -> Dictionary:
	var root := get_tree().current_scene
	var players: Array[Dictionary] = []
	if root != null:
		_collect_audio_players(root, players)

	return {
		"reason": reason,
		"capturedAt": Time.get_datetime_string_from_system(true),
		"currentScenePath": _get_current_scene_path(),
		"players": players,
		"playerCount": players.size(),
		"activePlayerCount": _count_active_players(players)
	}


func _collect_runtime_nodes(node: Node, parent_path: String, results: Array[Dictionary]) -> void:
	var node_path := str(node.get_path())
	results.append(
		{
			"path": node_path,
			"parentPath": parent_path,
			"name": node.name,
			"type": node.get_class(),
			"childCount": node.get_child_count(),
			"properties": _collect_node_properties(node)
		}
	)

	for child in node.get_children():
		if child is Node:
			_collect_runtime_nodes(child, node_path, results)


func _collect_node_properties(node: Node) -> Dictionary:
	var properties := {}

	for property_name in TRACKED_PROPERTY_NAMES:
		if _has_property(node, property_name):
			properties[property_name] = _serialize_variant(node.get(property_name))

	if node is CanvasItem:
		var canvas_item := node as CanvasItem
		properties["global_position"] = _serialize_variant(canvas_item.global_position)

	if node is Control:
		var control := node as Control
		properties["size"] = _serialize_variant(control.size)

	return properties


func _collect_audio_players(node: Node, results: Array[Dictionary]) -> void:
	if _is_audio_player(node):
		results.append(_build_audio_player_payload(node))

	for child in node.get_children():
		if child is Node:
			_collect_audio_players(child, results)


func _build_audio_player_payload(node: Node) -> Dictionary:
	var stream: Variant = node.get("stream") if _has_property(node, "stream") else null
	var playback_position := 0.0
	if node.has_method("get_playback_position"):
		playback_position = float(node.call("get_playback_position"))

	var length_sec := 0.0
	if stream != null and stream.has_method("get_length"):
		length_sec = float(stream.call("get_length"))

	var payload := {
		"path": str(node.get_path()),
		"name": node.name,
		"type": node.get_class(),
		"playing": bool(node.get("playing")) if _has_property(node, "playing") else false,
		"streamPaused": bool(node.get("stream_paused")) if _has_property(node, "stream_paused") else false,
		"autoplay": bool(node.get("autoplay")) if _has_property(node, "autoplay") else false,
		"bus": str(node.get("bus")) if _has_property(node, "bus") else "",
		"volumeDb": float(node.get("volume_db")) if _has_property(node, "volume_db") else 0.0,
		"playbackPosition": snappedf(playback_position, 0.001),
		"lengthSec": snappedf(length_sec, 0.001),
		"streamType": stream.get_class() if stream != null else "",
		"streamResourcePath": str(stream.resource_path) if stream is Resource else ""
	}

	return payload


func _count_active_players(players: Array[Dictionary]) -> int:
	var count := 0
	for player in players:
		if bool(player.get("playing", false)):
			count += 1
	return count


func _is_audio_player(node: Node) -> bool:
	return node is AudioStreamPlayer or node is AudioStreamPlayer2D or node is AudioStreamPlayer3D


func _has_property(target: Object, property_name: String) -> bool:
	var cache_key := _get_property_cache_key(target)
	if not _property_presence_cache.has(cache_key):
		var property_names := {}
		for property_info in target.get_property_list():
			property_names[str(property_info.get("name", ""))] = true
		_property_presence_cache[cache_key] = property_names

	return bool((_property_presence_cache[cache_key] as Dictionary).get(property_name, false))


func _get_property_cache_key(target: Object) -> String:
	var script_path := ""
	var script_ref: Variant = target.get_script()
	if script_ref is Resource:
		script_path = str(script_ref.resource_path)
	return "%s|%s" % [target.get_class(), script_path]


func _serialize_variant(value: Variant) -> Variant:
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_VECTOR2:
			return {"x": value.x, "y": value.y}
		TYPE_VECTOR2I:
			return {"x": value.x, "y": value.y}
		TYPE_COLOR:
			return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_NODE_PATH, TYPE_STRING_NAME:
			return str(value)
		TYPE_ARRAY:
			var serialized_array: Array = []
			for entry in value:
				serialized_array.append(_serialize_variant(entry))
			return serialized_array
		TYPE_DICTIONARY:
			var serialized_dict := {}
			for key in value.keys():
				serialized_dict[str(key)] = _serialize_variant(value[key])
			return serialized_dict
		_:
			return str(value)


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
# Editor -> Game command handling
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
	var params: Dictionary = data[0] if data.size() > 0 and typeof(data[0]) == TYPE_DICTIONARY else {}
	var paused: bool = bool(params.get("paused", true))
	get_tree().paused = paused
	_send_event("pause_result", {"paused": get_tree().paused})


func _handle_simulate_mouse_command(data: Array) -> void:
	_reset_poll_backoff()
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
			var drag_press_event := InputEventMouseButton.new()
			drag_press_event.position = Vector2(x, y)
			drag_press_event.button_index = btn_index
			drag_press_event.pressed = true
			Input.parse_input_event(drag_press_event)

			var motion_event := InputEventMouseMotion.new()
			motion_event.position = Vector2(end_x, end_y)
			motion_event.relative = Vector2(end_x - x, end_y - y)
			Input.parse_input_event(motion_event)

			var drag_release_event := InputEventMouseButton.new()
			drag_release_event.position = Vector2(end_x, end_y)
			drag_release_event.button_index = btn_index
			drag_release_event.pressed = false
			Input.parse_input_event(drag_release_event)

		"long_press":
			var long_press_event := InputEventMouseButton.new()
			long_press_event.position = Vector2(x, y)
			long_press_event.button_index = btn_index
			long_press_event.pressed = true
			Input.parse_input_event(long_press_event)

			_deferred_long_press_release(Vector2(x, y), btn_index, duration_ms / 1000.0)

	_emit_runtime_snapshot_if_changed("simulate_mouse")
	_emit_audio_snapshot_if_changed("simulate_mouse")
	_send_event("mouse_result", {"action": action, "x": x, "y": y, "success": true})


func _deferred_long_press_release(pos: Vector2, btn: MouseButton, delay: float) -> void:
	await get_tree().create_timer(delay).timeout
	_reset_poll_backoff()
	var release_event := InputEventMouseButton.new()
	release_event.position = pos
	release_event.button_index = btn
	release_event.pressed = false
	Input.parse_input_event(release_event)
	_emit_runtime_snapshot_if_changed("long_press_release")
	_emit_audio_snapshot_if_changed("long_press_release")


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


func _get_current_snapshot_interval_sec() -> float:
	return _idle_snapshot_interval_sec if _unchanged_poll_count >= STABLE_POLL_THRESHOLD else _snapshot_interval_sec


func _reset_poll_backoff() -> void:
	_snapshot_elapsed = 0.0
	_unchanged_poll_count = 0


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
		@warning_ignore("integer_division")
		i = int(i / 26) - 1
		if i < 0:
			break
	return label
