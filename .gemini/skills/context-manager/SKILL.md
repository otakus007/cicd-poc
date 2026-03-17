---
name: context-manager
description: Strategies for maintaining clean and efficient AI context windows during long sessions.
triggers:
  - cleanup-context
  - session-efficiency
  - reduce-noise
---
# Context Manager

Maintaining high signal-to-noise ratio in AI interactions.

## Techniques
- **Surgical Reads:** Only read the lines of code necessary for the current step.
- **Summarization:** Condense long outputs into actionable summaries.
- **Resetting:** Knowing when to start a fresh session or clear the current context.
- **Delegation:** Using sub-agents for heavy research to keep the main history lean.

## Rules
- Never repeat full file contents unless explicitly asked.
- Avoid conversational filler.
- Use parallel tool calls to save turns.
