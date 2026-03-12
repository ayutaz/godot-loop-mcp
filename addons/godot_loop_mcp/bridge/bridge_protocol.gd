@tool
extends RefCounted

const JSON_RPC_VERSION := "2.0"


static func encode_message(message: Dictionary) -> PackedByteArray:
	var payload := JSON.stringify(message).to_utf8_buffer()
	var frame := PackedByteArray()
	frame.append((_length_byte(payload.size(), 24)))
	frame.append((_length_byte(payload.size(), 16)))
	frame.append((_length_byte(payload.size(), 8)))
	frame.append((_length_byte(payload.size(), 0)))
	frame.append_array(payload)
	return frame


static func decode_messages(buffer: PackedByteArray) -> Dictionary:
	var messages: Array[Dictionary] = []
	var cursor := 0
	while buffer.size() - cursor >= 4:
		var payload_size := _read_length(buffer, cursor)
		if buffer.size() - cursor - 4 < payload_size:
			break
		var payload := buffer.slice(cursor + 4, cursor + 4 + payload_size)
		var parsed := JSON.parse_string(payload.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY:
			messages.append(parsed)
		cursor += 4 + payload_size

	var remaining := PackedByteArray()
	if cursor < buffer.size():
		remaining = buffer.slice(cursor, buffer.size())

	return {
		"messages": messages,
		"remaining": remaining
	}


static func make_request(id: String, method: String, params: Dictionary = {}) -> Dictionary:
	return {
		"jsonrpc": JSON_RPC_VERSION,
		"id": id,
		"method": method,
		"params": params
	}


static func make_response(id: String, result: Variant = {}) -> Dictionary:
	return {
		"jsonrpc": JSON_RPC_VERSION,
		"id": id,
		"result": result
	}


static func make_error(id: String, code: int, message: String, data: Variant = null) -> Dictionary:
	var error := {
		"code": code,
		"message": message
	}
	if data != null:
		error["data"] = data
	return {
		"jsonrpc": JSON_RPC_VERSION,
		"id": id,
		"error": error
	}


static func is_request(message: Dictionary) -> bool:
	return message.has("id") and message.has("method")


static func is_response(message: Dictionary) -> bool:
	return message.has("id") and (message.has("result") or message.has("error")) and not message.has("method")


static func _length_byte(length: int, shift: int) -> int:
	return (length >> shift) & 0xFF


static func _read_length(buffer: PackedByteArray, offset: int) -> int:
	return (
		(int(buffer[offset]) << 24)
		| (int(buffer[offset + 1]) << 16)
		| (int(buffer[offset + 2]) << 8)
		| int(buffer[offset + 3])
	)

