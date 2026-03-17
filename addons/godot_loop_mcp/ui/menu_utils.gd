@tool
extends RefCounted
## Shared utilities for editor menu bar operations.


static func find_menu_bar(control: Control) -> MenuBar:
	if control is MenuBar:
		return control as MenuBar
	for child_index in range(control.get_child_count()):
		var child := control.get_child(child_index)
		if child is Control:
			var found := find_menu_bar(child as Control)
			if found != null:
				return found
	return null
