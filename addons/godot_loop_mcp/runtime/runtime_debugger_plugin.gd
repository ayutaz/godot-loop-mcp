@tool
extends EditorDebuggerPlugin

const MESSAGE_PREFIX := "godot_loop_mcp"

var _capture_store


func _init(capture_store) -> void:
	_capture_store = capture_store


func _has_capture(capture: String) -> bool:
	return capture == MESSAGE_PREFIX


func _capture(message: String, data: Array, session_id: int) -> bool:
	if _capture_store != null and _capture_store.has_method("record_event"):
		_capture_store.record_event(message, data, session_id)
	return true
