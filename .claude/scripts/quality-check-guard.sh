#!/bin/bash
# アシスタントが Edit/Write 系ツールでファイルを変更した時だけ品質チェックを実行する。
# 目印（センチネル）が無ければ即 exit 0。
# ユーザーの手動編集はツールを通らないため目印が付かず、チェックは走らない。
PROJECT_DIR="/Users/iyoda/Documents/workspace/Web_Workspace/logotope"
SENTINEL="$PROJECT_DIR/.git/assistant-edited"

# アシスタントの編集が無い → チェックしない（無駄な再実行・ループを防ぐ）
[ -f "$SENTINEL" ] || exit 0

# 目印を消してから実行（失敗で再起動されても、追加の編集が無ければ次はスキップ）
rm -f "$SENTINEL"
exec "$PROJECT_DIR/.claude/scripts/quality-check.sh"
