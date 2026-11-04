#!/usr/bin/env bash
# Compute the full travel-time matrices in parallel chunks, then merge.
# Usage: pipeline/run_travel_matrix.sh [chunks] [memory per process]
set -euo pipefail
cd "$(dirname "$0")/.."
CHUNKS=${1:-32}
MEM=${2:-8G}
OUT=public/data/travel
POINTS=data/interim/bars.json
mkdir -p "$OUT/parts" data/interim/matrix_logs
rm -f "$OUT"/parts/part_*
for ((i = 0; i < CHUNKS; i++)); do
  python pipeline/06_travel_matrix.py --points "$POINTS" --out "$OUT" --chunk "$i" --chunks "$CHUNKS" \
    --max-memory "$MEM" > "data/interim/matrix_logs/chunk_$i.log" 2>&1 &
done
wait
python pipeline/06_travel_matrix.py --points "$POINTS" --out "$OUT" --merge --chunks "$CHUNKS"
rm -r "$OUT/parts"
