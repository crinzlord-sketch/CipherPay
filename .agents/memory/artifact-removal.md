---
name: Removing an artifact
description: How to delete an artifact when its workflow is artifact-managed
---

To delete an artifact, delete its directory (`rm -rf artifacts/<slug>`). The platform auto-deregisters it and removes its managed workflow.

**Why:** `removeWorkflow({name})` fails with `PROHIBITED_ACTION: "<name>" is managed by an artifact and cannot be deleted via deleteRunWorkflow` for artifact-bound workflows. The artifacts skill has no `removeArtifact` callback — directory deletion is the supported path.

**How to apply:** When asked to remove/delete an artifact, skip `removeWorkflow`; just delete the dir. `pnpm-workspace.yaml` discovers packages via the `artifacts/*` glob, so no manifest edit is needed.
