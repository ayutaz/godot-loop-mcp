extends Node

const MESSAGE_PREFIX := "godot_loop_mcp"


func _ready() -> void:
	if not EngineDebugger.is_active():
		return

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
