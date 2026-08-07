# Reporting server capabilities

Reporting provides economics and observability.

- `metrics` exposes product and Prometheus metrics.
- `spend` records token usage, budgets, and spend.
- `awareness` exposes participation and rollout awareness.

This directory map does not impose a group-level dependency direction. Existing per-domain NX
scope constraints are authoritative; reporting currently has explicit domain-level edges with the
tenancy group. New cross-group imports require an explicit domain-level decision.
