@tool
extends RefCounted

signal log_emitted(level: String, message: String, context: Dictionary)
signal state_changed(state: String)
signal handshake_completed(server_identity: Dictionary)

const BridgeProtocol = preload("res://addons/godot_loop_mcp/bridge/bridge_protocol.gd")

const STATE_DISCONNECTED := "disconnected"
const STATE_CONNECTING := "connecting"
const STATE_HANDSHAKING := "handshaking"
const STATE_READY := "ready"
const STATE_RECONNECT_WAIT := "reconnect_wait"

var _config: Dictionary
var _client_identity: Dictionary
var _request_handler: Callable
var _tcp := StreamPeerTCP.new()
var _incoming_buffer := PackedByteArray()
var _desired_running := false
var _state := STATE_DISCONNECTED
var _connect_elapsed_ms := 0
var _reconnect_wait_remaining := 0.0
var _reconnect_attempts := 0
var _request_counter := 0
var _heartbeat_elapsed_ms := 0
var _heartbeat_interval_ms := 15000
var _pending_requests: Dictionary = {}
var _server_identity: Dictionary = {}


func _init(config: Dictionary = {}, client_identity: Dictionary = {}, request_handler: Callable = Callable()) -> void:
	_config = config.duplicate(true)
	_client_identity = client_identity.duplicate(true)
	_request_handler = request_handler


func start() -> void:
	_desired_running = true
	_reconnect_attempts = 0
	_reconnect_wait_remaining = 0.0
	_connect()


func stop() -> void:
	_desired_running = false
	_clear_runtime_state()
	if _tcp.get_status() != StreamPeerTCP.STATUS_NONE:
		_tcp.disconnect_from_host()
	_set_state(STATE_DISCONNECTED)


func poll(delta: float) -> void:
	if _state == STATE_RECONNECT_WAIT:
		_reconnect_wait_remaining -= delta
		if _reconnect_wait_remaining <= 0.0 and _desired_running:
			_connect()
		return

	_tcp.poll()
	var status := _tcp.get_status()

	if status == StreamPeerTCP.STATUS_CONNECTING:
		_connect_elapsed_ms += int(delta * 1000.0)
		if _connect_elapsed_ms >= int(_config.get("connect_timeout_ms", 5000)):
			_schedule_reconnect("Connection attempt timed out.")
		return

	if status == StreamPeerTCP.STATUS_CONNECTED:
		if _state == STATE_CONNECTING:
			_on_connected()
		_read_available_messages()
		_check_pending_request_timeouts()
		if _state == STATE_READY:
			_heartbeat_elapsed_ms += int(delta * 1000.0)
			if _heartbeat_elapsed_ms >= _heartbeat_interval_ms:
				_heartbeat_elapsed_ms = 0
				_send_ping()
		return

	if status == StreamPeerTCP.STATUS_ERROR or (status == StreamPeerTCP.STATUS_NONE and _state != STATE_DISCONNECTED):
		_schedule_reconnect("Bridge disconnected.")


func _connect() -> void:
	_clear_runtime_state()
	_tcp = StreamPeerTCP.new()
	var host := str(_config.get("host", "127.0.0.1"))
	var port := int(_config.get("port", 6010))
	var error := _tcp.connect_to_host(host, port)
	if error != OK:
		_schedule_reconnect(
			"Failed to connect to bridge server.",
			{"host": host, "port": port, "error": error}
		)
		return

	_emit_log("info", "Connecting to bridge server.", {"host": host, "port": port})
	_set_state(STATE_CONNECTING)


func _on_connected() -> void:
	_emit_log("info", "Bridge socket connected, starting handshake.")
	_set_state(STATE_HANDSHAKING)
	_send_request("bridge.handshake.hello", _client_identity)


func _read_available_messages() -> void:
	while _tcp.get_available_bytes() > 0:
		var result := _tcp.get_partial_data(_tcp.get_available_bytes())
		var error := int(result[0])
		if error != OK:
			_schedule_reconnect("Failed to read from bridge server.", {"error": error})
			return
		var chunk: PackedByteArray = result[1]
		_incoming_buffer.append_array(chunk)

	var decoded := BridgeProtocol.decode_messages(_incoming_buffer)
	var messages: Array = decoded.get("messages", [])
	_incoming_buffer = decoded.get("remaining", PackedByteArray())
	for message in messages:
		_handle_message(message)


func _handle_message(message: Dictionary) -> void:
	if BridgeProtocol.is_request(message):
		_handle_request(message)
		return
	if BridgeProtocol.is_response(message):
		_handle_response(message)
		return
	_emit_log("warn", "Received malformed bridge message.", {"message": message})


func _handle_request(message: Dictionary) -> void:
	var request_id := str(message.get("id", ""))
	var method := str(message.get("method", ""))
	var params := message.get("params", {})

	match method:
		"bridge.handshake.sync":
			if typeof(params) == TYPE_DICTIONARY:
				_server_identity["sessionId"] = params.get("sessionId", _server_identity.get("sessionId", ""))
				_heartbeat_interval_ms = int(params.get("heartbeatIntervalMs", _heartbeat_interval_ms))
			_send_response(
				request_id,
				{
					"sessionId": _server_identity.get("sessionId", ""),
					"state": "ready",
					"role": "addon"
				}
			)
			_set_state(STATE_READY)
			_emit_log(
				"info",
				"Handshake sync completed.",
				{"session_id": _server_identity.get("sessionId", ""), "heartbeat_ms": _heartbeat_interval_ms}
			)
			_send_ping()
			handshake_completed.emit(_server_identity.duplicate(true))
		"bridge.ping":
			var ping_params := {}
			if typeof(params) == TYPE_DICTIONARY:
				ping_params = params
			_send_response(
				request_id,
				{
					"nonce": ping_params.get("nonce", ""),
					"receivedAtMs": Time.get_ticks_msec(),
					"role": "addon",
					"sessionId": _server_identity.get("sessionId", "")
				}
			)
		_:
			if _request_handler.is_valid():
				var outcome = _request_handler.call(method, params)
				if typeof(outcome) == TYPE_DICTIONARY and bool(outcome.get("handled", false)):
					if outcome.has("error"):
						var error_payload: Dictionary = outcome.get("error", {})
						_send_error(
							request_id,
							int(error_payload.get("code", -32603)),
							str(error_payload.get("message", "Unhandled addon request error.")),
							error_payload.get("data", null)
						)
					else:
						_send_response(request_id, outcome.get("result", {}))
					return
			_send_error(request_id, -32601, "Method not found.", {"method": method})


func _handle_response(message: Dictionary) -> void:
	var request_id := str(message.get("id", ""))
	if not _pending_requests.has(request_id):
		return

	var pending: Dictionary = _pending_requests[request_id]
	_pending_requests.erase(request_id)

	if message.has("error"):
		_emit_log(
			"error",
			"Bridge request failed.",
			{"method": pending.get("method", ""), "error": message.get("error", {})}
		)
		if pending.get("method", "") == "bridge.handshake.hello":
			_schedule_reconnect("Handshake hello failed.")
		return

	match str(pending.get("method", "")):
		"bridge.handshake.hello":
			var result := message.get("result", {})
			if typeof(result) == TYPE_DICTIONARY:
				_server_identity = result.duplicate(true)
				if result.has("bridge"):
					var bridge_value: Variant = result.get("bridge", {})
					if typeof(bridge_value) == TYPE_DICTIONARY:
						var bridge_config: Dictionary = bridge_value
						_heartbeat_interval_ms = int(bridge_config.get("heartbeatIntervalMs", _heartbeat_interval_ms))
			_emit_log(
				"info",
				"Received server hello.",
				{
					"session_id": _server_identity.get("sessionId", ""),
					"server": _server_identity.get("product", {})
				}
			)


func _send_request(method: String, params: Dictionary = {}) -> String:
	var request_id := _next_request_id()
	_pending_requests[request_id] = {
		"method": method,
		"sent_at_ms": Time.get_ticks_msec()
	}
	_send_message(BridgeProtocol.make_request(request_id, method, params))
	return request_id


func _send_response(request_id: String, result: Variant = {}) -> void:
	_send_message(BridgeProtocol.make_response(request_id, result))


func _send_error(request_id: String, code: int, message: String, data: Variant = null) -> void:
	_send_message(BridgeProtocol.make_error(request_id, code, message, data))


func _send_ping() -> void:
	_send_request(
		"bridge.ping",
		{
			"nonce": _make_nonce(),
			"sentAtMs": Time.get_ticks_msec(),
			"role": "addon",
			"sessionId": _server_identity.get("sessionId", "")
		}
	)


func _send_message(message: Dictionary) -> void:
	if _tcp.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	_tcp.put_data(BridgeProtocol.encode_message(message))


func _check_pending_request_timeouts() -> void:
	var now_ms := Time.get_ticks_msec()
	var timeout_ms := int(_config.get("handshake_timeout_ms", 5000))
	var timed_out_ids: Array[String] = []

	for request_id in _pending_requests.keys():
		var pending: Dictionary = _pending_requests[request_id]
		if now_ms - int(pending.get("sent_at_ms", now_ms)) >= timeout_ms:
			timed_out_ids.append(str(request_id))

	for request_id in timed_out_ids:
		var pending: Dictionary = _pending_requests[request_id]
		_pending_requests.erase(request_id)
		if pending.get("method", "") == "bridge.handshake.hello":
			_schedule_reconnect("Handshake response timed out.")
			return
		_emit_log("warn", "Bridge request timed out.", {"method": pending.get("method", "")})


func _schedule_reconnect(reason: String, context: Dictionary = {}) -> void:
	_emit_log("warn", reason, context)
	_clear_runtime_state()
	if _tcp.get_status() != StreamPeerTCP.STATUS_NONE:
		_tcp.disconnect_from_host()
	if not _desired_running:
		_set_state(STATE_DISCONNECTED)
		return

	_reconnect_attempts += 1
	var initial_delay_ms := int(_config.get("reconnect_initial_delay_ms", 2000))
	var max_delay_ms := int(_config.get("reconnect_max_delay_ms", 10000))
	var computed_delay_ms := int(min(float(max_delay_ms), float(initial_delay_ms) * pow(2.0, _reconnect_attempts - 1)))
	_reconnect_wait_remaining = float(computed_delay_ms) / 1000.0
	_set_state(STATE_RECONNECT_WAIT)


func _clear_runtime_state() -> void:
	_pending_requests.clear()
	_incoming_buffer = PackedByteArray()
	_server_identity = {}
	_connect_elapsed_ms = 0
	_heartbeat_elapsed_ms = 0


func _set_state(next_state: String) -> void:
	if _state == next_state:
		return
	_state = next_state
	state_changed.emit(_state)


func _emit_log(level: String, message: String, context: Dictionary = {}) -> void:
	log_emitted.emit(level, message, context)


func _next_request_id() -> String:
	_request_counter += 1
	return "addon-%d" % _request_counter


func _make_nonce() -> String:
	return "%d" % Time.get_ticks_usec()
