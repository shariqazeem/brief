#!/usr/bin/env bash
# Stop all workforce agents. Also cleans up any legacy operator/strategy/
# execution PIDs that may still be around from the old build.
set -euo pipefail

for agent in research planner treasury operator strategy strategy-alt execution; do
  pidfile="/tmp/brief-$agent.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      echo "stopped $agent (pid=$pid)"
    else
      echo "$agent pid=$pid was already dead"
    fi
    rm -f "$pidfile"
  else
    echo "$agent has no pidfile"
  fi
done

# Nuke any orphaned tsx agent processes (workforce + legacy).
pkill -f "tsx.*agents/workforce/(research|planner|treasury)/index.ts" 2>/dev/null || true
pkill -f "tsx.*agents/(operator|research|strategy|strategy-alt|execution)/index.ts" 2>/dev/null || true
echo "done"
