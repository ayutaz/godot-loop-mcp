# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP ベース開発ループです。

このプロジェクトでは、次の構成を目指します。

- Godot Editor Addon による editor / runtime のライブ観測
- tools / resources / prompts を提供する外部 MCP Server
- inspect -> edit -> run -> verify を回せる AI 開発ループ

## ステータス

このリポジトリは立ち上げ初期段階です。

最初のターゲットは、Unity の uLoopMCP に着想を得た Godot 4.4+ 向けの構成です。

- Scene / Script の editor-aware な観測
- runtime error / log の取得
- play / stop 制御
- project / resource 検索
- 段階的に安全性を管理した自動化機能

## ライセンス

このプロジェクトは Apache License 2.0 で公開します。  
Copyright 2026 ayutaz.
