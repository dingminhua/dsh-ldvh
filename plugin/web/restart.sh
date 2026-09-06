#!/bin/bash
# LDVH Web 开发服务器启动脚本
# 固定端口：前端 5173，后端 3001
# 如果端口被占用，自动关闭占用进程
#
# ⚠️ 已知临时桥接（见 README-MIGRATION.md）：后端事实读取仍依赖 v4 归档的
#    Python Helper（ldvh CLI）与 v4 工作区配置。DSH Helper 集成落地后，
#    本脚本下面的三个环境变量应改为指向 v5 登记载体。

set -e

V4_ARCHIVE="/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4"
V4_WORKSPACE="/Users/dmh2002/poker_hud_projects"

echo "🔍 检查端口占用..."

# 关闭占用端口的进程
for PORT in 5173 3001; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "⚠️  端口 $PORT 被占用 (PID: $PID)，正在关闭..."
    kill -9 $PID 2>/dev/null || true
    sleep 0.5
  fi
done

echo "✅ 端口已就绪"

export LDVH_ROOT="$V4_ARCHIVE"
export LDVH_WORKSPACE_ROOT="$V4_WORKSPACE"
export LDVH_HELPER_EXECUTABLE="$V4_ARCHIVE/ldvh"
export LDVH_WEB_WORKTREE_LOCATOR="$V4_ARCHIVE"

echo "🚀 启动开发服务器（Helper 指向 v4 归档：$V4_ARCHIVE）..."
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:3001"
echo ""

npm run dev
