---
name: update
description: Safely update Claudex or its pinned gateway with verification and rollback.
allowed-tools: Bash, AskUserQuestion
---

Update behavior is not implemented in the scaffold. Never download or execute an
artifact without a pinned version and verified checksum. Future updates must
stage health checks and retain the previous known-good version for rollback.
