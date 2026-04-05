@tool
extends RefCounted

const MAX_EVENTS := 200
const MESSAGE_PREFIX := "godot_loop_mcp"
const SNAPSHOT_ONLY_EVENTS := {
	"runtime_snapshot": true,
	"audio_players_snapshot": true
}

var _events: Array[Dictionary] = []
var _latest_runtime_snapshot := {}
var _latest_audio_snapshot := {}


func get_capability_overrides() -> Dictionary:
	return {
		"runtime.debug": "enabled" if is_supported() else "disabled"
	}


func is_supported() -> bool:
	return DisplayServer.get_name() != "headless"


func record_event(message: String, data: Array, session_id: int) -> void:
	if not is_supported():
		return

	var event_name := message
	if event_name.begins_with("%s:" % MESSAGE_PREFIX):
		event_name = event_name.trim_prefix("%s:" % MESSAGE_PREFIX)

	_cache_snapshot_payload(event_name, data)

	var payload := {
		"message": message,
		"event": event_name,
		"sessionId": session_id,
		"timestamp": Time.get_datetime_string_from_system(true),
		"data": data.duplicate(true)
	}

	if SNAPSHOT_ONLY_EVENTS.has(event_name):
		return

	_events.append(payload)
	while _events.size() > MAX_EVENTS:
		_events.remove_at(0)


func clear_events() -> int:
	var cleared := _events.size()
	_events.clear()
	return cleared


func clear_live_snapshots() -> void:
	_latest_runtime_snapshot = {}
	_latest_audio_snapshot = {}


func get_events_payload(limit: int) -> Dictionary:
	var clamped_limit := maxi(limit, 1)
	var start := maxi(_events.size() - clamped_limit, 0)
	var entries: Array[Dictionary] = []
	for index in range(start, _events.size()):
		entries.append(_events[index].duplicate(true))

	return {
		"backend": "editor-debugger-plugin",
		"supported": is_supported(),
		"entries": entries
	}


func get_latest_runtime_snapshot() -> Dictionary:
	return _latest_runtime_snapshot.duplicate(true)


func get_latest_audio_snapshot() -> Dictionary:
	return _latest_audio_snapshot.duplicate(true)


func _cache_snapshot_payload(event_name: String, data: Array) -> void:
	if data.is_empty() or typeof(data[0]) != TYPE_DICTIONARY:
		return

	var payload: Dictionary = data[0]
	match event_name:
		"runtime_snapshot":
			_latest_runtime_snapshot = payload.duplicate(true)
		"audio_players_snapshot":
			_latest_audio_snapshot = payload.duplicate(true)
