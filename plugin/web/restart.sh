#!/bin/bash
# LDVH Web 开发服务器重启脚本
# 固定端口：前端 5173，后端 3001
# 如果端口被占用，自动关闭占用进程

set -e

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
echo "🚀 启动开发服务器..."
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:3001"
echo ""

npm run dev
