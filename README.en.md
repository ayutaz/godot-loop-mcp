# godot-loop-mcp

[日本語 README](README.md)

`godot-loop-mcp` is an MCP-oriented development loop for Godot 4.4+.

The project is intended to provide:

- a Godot Editor addon for live editor / runtime introspection
- an external MCP server for tools, resources, and prompts
- an AI development loop for inspect -> edit -> run -> verify workflows

## Status

This repository is still in the bootstrap phase, but `M0` is complete.

The current baseline is a minimal `Godot Editor Addon + External MCP Server + Local TCP Bridge` design inspired by Unity's uLoopMCP:

- Implemented: addon skeleton, TypeScript server skeleton, `handshake`, bidirectional `ping`, capability manifest, reconnect policy
- Next target: `M1` read-only observation tools/resources
- Roadmap: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)

## M0 Bootstrap

The initial M0 bridge scaffolding is implemented and smoke-tested.

- Contract: [docs/m0-bridge-contract.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-bridge-contract.md)
- Local development: [docs/m0-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-local-development.md)
- Milestones: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)

Verified minimal smoke test:

```powershell
npm --prefix packages/server run start
godot_console.exe --headless --editor --quit-after 240 --path .
```

## License

This project is licensed under the Apache License, Version 2.0.  
Copyright 2026 ayutaz.
