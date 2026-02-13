#!/bin/bash
set -e
OUTDIR="docs/diagrams/images"
for f in docs/diagrams/fargate-*.md; do
  base=$(basename "$f" .md)
  sed -n '/^```mermaid$/,/^```$/{ /^```/d; p }' "$f" > "/tmp/${base}.mmd"
  echo "Rendering $base..."
  mmdc -i "/tmp/${base}.mmd" -o "${OUTDIR}/${base}.png" -w 1920 -H 1080 -b transparent 2>&1 || echo "FAILED: $base"
done
ls -la "$OUTDIR"/fargate-*.png 2>/dev/null
