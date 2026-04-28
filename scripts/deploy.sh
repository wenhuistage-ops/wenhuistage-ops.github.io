#!/usr/bin/env bash
# 一鍵推送：前端 push origin/main + 後端 firebase deploy
#
# 用法：
#   scripts/deploy.sh                  # 自動：前端必推；後端只在 firebase-functions/ 有改動時 deploy
#   scripts/deploy.sh --skip-frontend  # 只動後端
#   scripts/deploy.sh --skip-backend   # 只動前端
#   scripts/deploy.sh --force-backend  # 不管有沒有改都 deploy 後端
#
# 設計：可以從主 repo 或 worktree 跑都行；後端 deploy 自動切到主 repo
# 因為 worktree 通常沒裝 functions/node_modules

set -uo pipefail

REPO_ROOT="/Users/linjie/Documents/GitHub/wenhuistage-ops.github.io"
PROJECT_ID="wenhui-check-in-system"

# ----- 輸出工具 -----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

ok()    { echo -e "${GREEN}✓${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; }
info()  { echo -e "${BLUE}→${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
step()  { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ----- 解析參數 -----
SKIP_FRONTEND=false
SKIP_BACKEND=false
FORCE_BACKEND=false

for arg in "$@"; do
    case "$arg" in
        --skip-frontend)  SKIP_FRONTEND=true ;;
        --skip-backend)   SKIP_BACKEND=true ;;
        --force-backend)  FORCE_BACKEND=true ;;
        -h|--help)
            head -12 "$0" | tail -10
            exit 0
            ;;
        *)
            fail "未知參數：$arg"
            echo "用 -h 看用法"
            exit 1
            ;;
    esac
done

# ----- 前置檢查 -----
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    fail "不在 git repo 內，請 cd 到專案目錄"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    fail "工作區有未提交改動，先 commit 再推"
    git status --short
    exit 1
fi

# remote URL 有嵌 username 會繞過 credential helper（github 已停用密碼登入）
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if echo "$REMOTE_URL" | grep -qE "https://[^@]+@github\.com"; then
    warn "remote URL 嵌了 username，會跳過 gh credential helper"
    info "自動修正：移除 username"
    CLEAN_URL=$(echo "$REMOTE_URL" | sed -E 's#https://[^@]+@github\.com#https://github.com#')
    git remote set-url origin "$CLEAN_URL"
    ok "remote → $CLEAN_URL"
fi

# credential.helper 沒設 / 設錯 / 被 local 空值覆寫 → 都會卡 push
EXPECTED_HELPER='!gh auth git-credential'
LOCAL_HELPER_RAW=$(git config --local --get-all credential.helper 2>/dev/null || true)
GLOBAL_HELPER=$(git config --global --get-all credential.helper 2>/dev/null || true)

# local 層若有任何「空值」設定會覆寫 global → 直接 unset 整個 local helper
if [ -n "$LOCAL_HELPER_RAW" ] && echo "$LOCAL_HELPER_RAW" | grep -qE '^\s*$'; then
    warn "本地 .git/config 有空 credential.helper，會覆寫 global 設定"
    info "自動修正：移除本地空 helper"
    git config --local --unset-all credential.helper 2>/dev/null || true
    ok "已移除本地空 helper"
fi

# 重新讀 effective helper（local 沒 → 走 global）
EFFECTIVE_HELPER=$(git config --get credential.helper 2>/dev/null || true)

# 視為「無效」的條件：完全沒設，或不是預期的 gh credential 形式
if [ -z "$EFFECTIVE_HELPER" ] || ! echo "$EFFECTIVE_HELPER" | grep -qE 'gh auth git-credential'; then
    if command -v gh > /dev/null && gh auth status > /dev/null 2>&1; then
        if [ -n "$EFFECTIVE_HELPER" ]; then
            warn "credential.helper 設定有誤：「$EFFECTIVE_HELPER」"
        else
            warn "credential.helper 未設定且 GitHub 已停用密碼登入"
        fi
        info "自動修正：用 gh CLI 接管 git credential"
        git config --global credential.helper "$EXPECTED_HELPER"
        ok "credential.helper → $EXPECTED_HELPER"
    else
        fail "credential.helper 未設定，且未偵測到 gh CLI（需先 brew install gh && gh auth login）"
        exit 1
    fi
fi

# ----- 偵測本次要推的 commits 與後端是否有變更 -----
git fetch origin main --quiet 2>/dev/null || true
NEW_COMMITS=$(git log origin/main..HEAD --pretty=oneline 2>/dev/null)
COMMIT_COUNT=$(echo -n "$NEW_COMMITS" | grep -c '^' || true)

BACKEND_CHANGED=false
if [ -n "$NEW_COMMITS" ]; then
    if git diff --name-only origin/main HEAD -- firebase-functions/ 2>/dev/null | grep -q .; then
        BACKEND_CHANGED=true
    fi
fi

echo ""
echo -e "${GRAY}本次推送：${NC}"
if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo -e "  ${GRAY}(0 個新 commit — 只會檢查 push & 後端 deploy)${NC}"
else
    echo -e "$NEW_COMMITS" | sed "s/^/  /"
    echo ""
    if $BACKEND_CHANGED; then
        warn "firebase-functions/ 有改動 → 將 deploy 後端"
    else
        info "firebase-functions/ 無改動 → 跳過後端 deploy"
    fi
fi

# ====================================================
# 前端
# ====================================================
if $SKIP_FRONTEND; then
    warn "跳過前端（--skip-frontend）"
else
    step "前端：git push origin HEAD:main"
    if git push origin HEAD:main; then
        ok "前端：推送成功（GitHub Pages 會自動部署，1~2 分鐘生效）"
    else
        fail "前端：推送失敗"
        exit 1
    fi
fi

# ====================================================
# 後端
# ====================================================
if $SKIP_BACKEND; then
    warn "跳過後端（--skip-backend）"
elif ! $BACKEND_CHANGED && ! $FORCE_BACKEND; then
    info "後端：跳過（沒改 firebase-functions/，加 --force-backend 強制 deploy）"
else
    step "後端：同步主 repo"
    cd "$REPO_ROOT"
    # 主 repo 可能還在舊 main，pull 拉最新（包括剛剛從 worktree push 的）
    if git pull origin main --ff-only; then
        ok "主 repo：已同步到最新"
    else
        fail "主 repo：pull 失敗（可能本地有未推的改動）"
        exit 1
    fi

    step "後端：部署 Cloud Functions"
    cd "$REPO_ROOT/firebase-functions"

    # 確認 dependencies
    if [ ! -d "functions/node_modules" ]; then
        info "首次部署：安裝 functions 依賴"
        (cd functions && npm install --silent)
    fi

    if firebase deploy --only functions --project "$PROJECT_ID"; then
        ok "後端：deploy 成功"
    else
        fail "後端：deploy 失敗（看上面 log）"
        exit 1
    fi
fi

echo ""
ok "全部完成 🎉"
