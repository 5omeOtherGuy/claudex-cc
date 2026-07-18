# Setup state machine

```text
UNINSTALLED
  └─ setup → MANAGER_READY

MANAGER_READY
  ├─ missing binary → INSTALLING_BINARY
  └─ valid binary   → GATEWAY_CONFIGURED

INSTALLING_BINARY
  ├─ verification failure → INSTALL_ERROR
  └─ success              → GATEWAY_CONFIGURED

GATEWAY_CONFIGURED
  ├─ no credential → AUTH_REQUIRED
  └─ credential    → AUTH_VALIDATING

AUTH_REQUIRED
  └─ login → AUTH_IN_PROGRESS

AUTH_IN_PROGRESS
  ├─ timeout/state/provider error → AUTH_ERROR
  └─ persisted token             → AUTH_VALIDATING

AUTH_VALIDATING
  ├─ entitlement failure → AUTH_OR_ENTITLEMENT_ERROR
  └─ success             → SERVICE_STARTING

SERVICE_STARTING
  ├─ bind/start failure → SERVICE_ERROR
  └─ health success     → SERVICE_HEALTHY

SERVICE_HEALTHY
  ├─ model unavailable → MODEL_ERROR
  └─ model available   → LAUNCHER_READY

LAUNCHER_READY
  └─ relaunch through claudex → READY
```

Every failure retains the previous known-good binary and configuration and
returns one targeted remediation. State transitions never expose credentials.
