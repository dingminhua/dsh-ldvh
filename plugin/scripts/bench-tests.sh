#!/bin/sh
# Benchmark the plugin test-suite in a load-resistant way.
#
# WHY this exists: on this developer machine the wall-clock time of a full run
# swings by ~25% (70s..90s) purely because other processes compete for CPU.
# A wall-clock-only comparison therefore cannot tell a real speedup from noise,
# which makes it useless as evidence for (or against) a change.
#
# Two numbers are reported instead:
#   real — wall clock; the number the Human actually feels, but noisy here.
#   cpu  — user+sys of the whole tree; the total work the suite performs.
#          It is (near) invariant to unrelated load, so it is the honest
#          signal for "did this change make the suite do less work".
#
# Usage: sh scripts/bench-tests.sh [runs]
set -eu

RUNS="${1:-3}"
cd "$(dirname "$0")/.."

echo "runs=$RUNS  cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')  load=$(uptime | sed 's/.*load averages*: //')"
i=0
while [ "$i" -lt "$RUNS" ]; do
	i=$((i + 1))
	# /usr/bin/time reports the child tree's rusage; capture both figures.
	# Mirror package.json's `npm test` exactly (incl. --test-force-exit) so the
	# benchmark measures what developers and CI actually run.
	out=$(/usr/bin/time -p node --test --test-force-exit test/*.test.mjs 2>&1 | tail -40 || true)
	real=$(printf '%s\n' "$out" | sed -n 's/^real \([0-9.]*\)$/\1/p' | tail -1)
	user=$(printf '%s\n' "$out" | sed -n 's/^user \([0-9.]*\)$/\1/p' | tail -1)
	sys=$(printf '%s\n' "$out" | sed -n 's/^sys \([0-9.]*\)$/\1/p' | tail -1)
	fail=$(printf '%s\n' "$out" | sed -n 's/^ℹ fail \([0-9]*\)$/\1/p' | tail -1)
	pass=$(printf '%s\n' "$out" | sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' | tail -1)
	cpu=$(awk -v u="${user:-0}" -v s="${sys:-0}" 'BEGIN{printf "%.1f", u+s}')
	printf 'run %d: real=%ss cpu=%ss pass=%s fail=%s\n' "$i" "${real:-?}" "$cpu" "${pass:-?}" "${fail:-?}"
done
