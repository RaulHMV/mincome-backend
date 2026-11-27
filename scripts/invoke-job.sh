#!/usr/bin/env bash
# Invoca un job de la Lambda y falla si la Lambda falló.
#   scripts/invoke-job.sh <función[:versión|alias]> <daily|migrate|bootstrap>
set -euo pipefail

function_name="$1"
job="$2"
result=$(mktemp)

case "$job" in
  daily|migrate|bootstrap) ;;
  *) echo "Job desconocido: $job" >&2; exit 1 ;;
esac

metadata=$(aws lambda invoke \
  --function-name "$function_name" \
  --cli-binary-format raw-in-base64-out \
  --cli-read-timeout 120 \
  --payload "{\"job\": \"$job\"}" \
  "$result")

echo "$job en $function_name:"
cat "$result"
echo

if grep -q '"FunctionError"' <<<"$metadata"; then
  echo "::error::El job $job falló en $function_name" >&2
  exit 1
fi
