# Godot Asset Library Release Checklist

作成日: 2026-03-12  
更新日: 2026-03-12

## 目的

GitHub Release で作成した Addon ZIP を、Godot Asset Library へ半手動で昇格する時の確認項目です。

## 入力元

- GitHub Release の tag
- GitHub Release の Addon ZIP URL
- `README.md`
- `LICENSE`
- icon URL

## 毎回確認する項目

- Asset version が Git tag と一致している
- 対応 Godot version が current release と一致している
- Addon ZIP が `addons/godot_loop_mcp/` から展開できる
- ZIP に `README.md` と `LICENSE` のコピーが入っている
- issues URL が GitHub repository を指している
- changelog 要約が reviewer に読める粒度になっている

## Asset Library 入力項目

- Title: `Godot Loop MCP`
- Category: `Tools`
- Godot version: current supported stable line
- Version: release tag から `v` を除いた値
- Download URL: GitHub Release の Addon ZIP asset
- Repository URL: `https://github.com/ayutaz/godot-loop-mcp`
- Issue tracker URL: `https://github.com/ayutaz/godot-loop-mcp/issues`
- Icon URL: release 時点の raw icon URL

## submit 前チェック

- release notes と Asset Library description の主張が一致している
- README のインストール手順が Addon ZIP 配布前提で読める
- known limitations が必要なら description に追記されている
- CI の smoke が green である
