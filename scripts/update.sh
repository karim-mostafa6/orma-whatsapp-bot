#!/usr/bin/env bash
# تحديث البوت على السيرفر (بيتشغّل من زرار «تحديث البوت» في صفحة الإعدادات).
# لو أي خطوة فشلت، بيرجع للنسخة اللي كانت شغالة.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${UPDATE_BRANCH:-main}"

git fetch -q origin "$BRANCH"
before=$(git rev-parse HEAD)
target=$(git rev-parse "origin/$BRANCH")
if [ "$before" = "$target" ]; then
  echo "UP_TO_DATE $(git rev-parse --short HEAD)"
  exit 0
fi

rollback() {
  echo "FAILED — بنرجع للنسخة القديمة" >&2
  git reset -q --hard "$before"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || true
  npm run build --silent >/dev/null 2>&1 || true
  exit 1
}
trap rollback ERR

git reset -q --hard "$target"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
trap - ERR
echo "UPDATED $(git rev-parse --short HEAD)"
