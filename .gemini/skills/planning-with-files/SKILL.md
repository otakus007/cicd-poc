---
name: planning-with-files
description: Expert at organizing complex tasks using local plan files (.md) for persistence and clarity.
triggers:
  - create-plan
  - track-progress
  - implementation-strategy
---
# Planning with Files

Workflow for managing complex, multi-step engineering tasks.

## Workflow
1. **Creation:** Create a `plans/` directory and a specific plan file.
2. **Structure:** Use Objective, Background, Steps, and Verification sections.
3. **Execution:** Update the plan as steps are completed.
4. **Finalization:** Verify all "Verification" points are met before closing the task.

## Best Practices
- Keep plans surgical and atomic.
- Include rollback steps for high-risk changes.
- Refer to specific file paths and line numbers.
