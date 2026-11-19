#!/bin/bash
# LDVH Web 开发服务器启动脚本
# 固定端口：前端 5173，后端 3001
# 如果端口被占用，自动关闭占用进程
#
# 事实读取走 v5 登记模式（与 plugin/lib/index.js 的 webApiBridgeEnv 同源）：
# 管辖项目清单读 DSH 用户配置下的 v5 登记载体，治理验证由 Express 侧 Node git
# 解析完成，全程零 Python Helper 依赖。
#
# LDVH_WORKSPACE_ROOT 指向仓库的父目录（管辖项目可分散在多个工作区）；
# LDVH_WEB_WORKTREE_LOCATOR 指向本仓库——它是默认管辖项目 dsh-ldvh 的 worktree。
# 若 DSH 用户配置不可用，Web 侧会如实报配置不可读，不静默回退到旧布局。

set -e

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# 本仓库（插件源码与 web/ 的所在目录）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# 工作区根：管辖项目可分散在其下多个目录，本仓库自身也在其中
WORKSPACE_ROOT="$(dirname "$PROJECT_ROOT")"
GOVERNED_CONFIG="$DSH_HOME/ldvh/governed-projects.yaml"

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

export LDVH_ROOT="$PROJECT_ROOT"
export LDVH_WORKSPACE_ROOT="$WORKSPACE_ROOT"
export LDVH_WEB_WORKTREE_LOCATOR="$PROJECT_ROOT"
export LDVH_GOVERNED_PROJECTS_CONFIG="$GOVERNED_CONFIG"
export LDVH_WEB_PREFERENCES="$DSH_HOME/ldvh/web-preferences.yaml"

if [ ! -f "$GOVERNED_CONFIG" ]; then
  echo "❌ 未找到 v5 登记载体：$GOVERNED_CONFIG"
  echo "   管辖项目清单缺失时 Web 无法确定事实来源，请先安装插件或补齐该文件。"
  exit 1
fi

echo "🚀 启动开发服务器（v5 登记模式）..."
echo "   登记载体: $GOVERNED_CONFIG"
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:3001"
echo ""

npm run dev
