@tool
extends EditorDebuggerPlugin

const MESSAGE_PREFIX := "godot_loop_mcp"
const CMD_PREFIX := "godot_loop_mcp_cmd"

var _capture_store
var _active_session_id: int = -1


func _init(capture_store) -> void:
	_capture_store = capture_store


func _has_capture(capture: String) -> bool:
	return capture == MESSAGE_PREFIX


func _capture(message: String, data: Array, session_id: int) -> bool:
	if _capture_store != null and _capture_store.has_method("record_event"):
		_capture_store.record_event(message, data, session_id)
	return true


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

func _session_started(session_id: int) -> void:
	_active_session_id = session_id


func _session_stopped() -> void:
	_active_session_id = -1


# ---------------------------------------------------------------------------
# Command sending (editor -> game)
# ---------------------------------------------------------------------------

func send_command(command_name: String, data: Dictionary) -> void:
	if _active_session_id < 0:
		return
	var session := get_session(_active_session_id)
	if session == null:
		return
	session.send_message("%s:%s" % [CMD_PREFIX, command_name], [data])


func send_pause(paused: bool) -> void:
	send_command("pause", {"paused": paused})


func send_simulate_mouse(params: Dictionary) -> void:
	send_command("simulate_mouse", params)


func send_enumerate_controls() -> void:
	send_command("enumerate_controls", {})
