#!/usr/bin/env bash
# Start all workforce agents in the background with logs in /tmp/.
# PIDs are written to /tmp/brief-<name>.pid so stop-all.sh can clean up.
#
# Day 1 (locked plan): only the Research agent exists in agents/workforce/.
# Planner and Treasury will be added on Days 2 and 3 — append them to this
# list as they land.
set -euo pipefail

cd "$(dirname "$0")/.."

for agent in research treasury; do
  if [ -f "/tmp/brief-$agent.pid" ] && kill -0 "$(cat /tmp/brief-$agent.pid)" 2>/dev/null; then
    echo "$agent already running (pid=$(cat /tmp/brief-$agent.pid))"
    continue
  fi
  nohup npm run "agent:$agent" > "/tmp/brief-$agent.log" 2>&1 &
  pid=$!
  echo $pid > "/tmp/brief-$agent.pid"
  disown
  echo "started $agent pid=$pid log=/tmp/brief-$agent.log"
done

echo
echo "Tail any agent with: tail -f /tmp/brief-<agent>.log"
echo "Stop all with:       agents/stop-all.sh"
