#!/bin/sh
set -eu

RUNS="${1:-3}"
cd "$(dirname "$0")/.."

echo "runs=$RUNS  cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')  load=$(uptime | sed 's/.*load averages*: //')"
i=0
while [ "$i" -lt "$RUNS" ]; do
	i=$((i + 1))
	out=$(/usr/bin/time -p node --test test/*.test.mjs 2>&1 | tail -40 || true)
	real=$(printf '%s\n' "$out" | sed -n 's/^real \([0-9.]*\)$/\1/p' | tail -1)
	user=$(printf '%s\n' "$out" | sed -n 's/^user \([0-9.]*\)$/\1/p' | tail -1)
	sys=$(printf '%s\n' "$out" | sed -n 's/^sys \([0-9.]*\)$/\1/p' | tail -1)
	fail=$(printf '%s\n' "$out" | sed -n 's/^ℹ fail \([0-9]*\)$/\1/p' | tail -1)
	pass=$(printf '%s\n' "$out" | sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' | tail -1)
	cpu=$(awk -v u="${user:-0}" -v s="${sys:-0}" 'BEGIN{printf "%.1f", u+s}')
	printf 'run %d: real=%ss cpu=%ss pass=%s fail=%s\n' "$i" "${real:-?}" "$cpu" "${pass:-?}" "${fail:-?}"
done
