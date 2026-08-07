# Gateway-governance server capabilities

These packages govern the external model and tool planes that the product can use.

- `mcp` owns the Obot catalogue and MCP governance.
- `integrations` owns integration authority and custody orchestration.
- `providers` owns BYOK provider keys and model registration.
- `model-routing` owns LiteLLM defaults and tenant-model routing.

Gateway governance may use IAM decisions, but it does not implement managed-agent or knowledge
behaviour. Cross-group work stays at public contracts and retains per-domain scope constraints.
