# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP ベース開発ループです。

このプロジェクトでは、次の構成を目指します。

- Godot Editor Addon による editor / runtime のライブ観測
- tools / resources / prompts を提供する外部 MCP Server
- inspect -> edit -> run -> verify を回せる AI 開発ループ

## ステータス

このリポジトリは立ち上げ初期段階ですが、`M0` は完了しています。

現在の到達点は、Unity の uLoopMCP に着想を得た `Godot Editor Addon + External MCP Server + Local TCP Bridge` の最小実装です。

- 実装済み: addon skeleton, TypeScript server skeleton, `handshake`, 双方向 `ping`, capability manifest, reconnect policy
- 次の対象: `M1` の read-only observation tools/resources
- 進行計画: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)

## M0 Bootstrap

M0 の bridge 実装は動作確認済みです。

- 契約仕様: [docs/m0-bridge-contract.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-bridge-contract.md)
- ローカル起動手順: [docs/m0-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-local-development.md)
- マイルストーン: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)

確認済みの最小スモークテスト:

```powershell
npm --prefix packages/server run start
godot_console.exe --headless --editor --quit-after 240 --path .
```

## ライセンス

このプロジェクトは Apache License 2.0 で公開します。  
Copyright 2026 ayutaz.
