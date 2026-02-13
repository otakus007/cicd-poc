#!/bin/bash
set -e

OUTDIR="docs/diagrams/images"
mkdir -p "$OUTDIR"

for f in docs/diagrams/fargate-*.md; do
  base=$(basename "$f" .md)
  echo "Rendering $base..."
  # Extract mermaid block
  sed -n '/^```mermaid$/,/^```$/{ /^```/d; p }' "$f" > "/tmp/${base}.mmd"
  mmdc -i "/tmp/${base}.mmd" -o "${OUTDIR}/${base}.png" -w 1920 -H 1080 --backgroundColor transparent 2>&1
done

echo "Done. Files:"
ls -la "$OUTDIR"/fargate-*.png
