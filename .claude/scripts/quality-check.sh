#!/bin/bash
# 型チェック・ユニットテスト・lint を実行し、失敗があれば exit 2 で Claude を再起動する
PROJECT_DIR="/Users/iyoda/Documents/workspace/Web_Workspace/logotope"
cd "$PROJECT_DIR" || exit 0

FAILED=0
ALL_OUTPUT=""

check() {
  local name="$1"
  shift
  local output
  output=$("$@" 2>&1)
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    FAILED=1
    ALL_OUTPUT="${ALL_OUTPUT}

=== ${name} FAILED (exit ${exit_code}) ===
${output}"
  fi
}

check "pnpm check (svelte-check)" pnpm check
check "pnpm test (vitest)" pnpm test
check "functions vitest" bash -c "cd functions && node_modules/.bin/vitest run"
check "pnpm lint (prettier + eslint)" pnpm lint

if [ "$FAILED" -eq 1 ]; then
  echo "品質チェック失敗。完了を報告する前にすべてのエラーを修正してください:${ALL_OUTPUT}"
  exit 2
fi
