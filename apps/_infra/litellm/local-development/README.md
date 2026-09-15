# Local LiteLLM profile

> [OpenCrane](../../../../README.md) › [apps](../../../README.md) › [_infra](../../README.md) › [litellm](../README.md) › local development

## What it owns

This directory turns one provider and model from the production-owned BYOK catalogue into the
secret-free LiteLLM configuration used by Tier 2 `local-llm`. The public model name remains `auto`,
so the current server follows its normal compiled-model path while LiteLLM routes to the selected
upstream model.

The catalogue remains owned by the model-routing package through its public
`libs/backend/server/gateways/model-routing/main/byok-provider-catalog.json` artifact; this package
does not copy it or reach into private source. Provider keys live outside this package under
`keys/.<provider>-key`. A key must be a non-symbolic regular file readable only by its owner. With no
explicit choice, the first recognized key filename
in lexical order chooses its provider and that provider's reviewed default model. Use `--provider`
and `--model` to make the choice explicit; an unreviewed provider, model, or cross-provider pairing
is refused.

The coordinator writes one session-owned YAML beside its other disposable secrets. It contains only
the `auto` alias, selected model, and `os.environ/OPENCRANE_LOCAL_PROVIDER_KEY` reference. The
coordinator supplies that one provider key and a separate disposable LiteLLM master key to the
loopback-bound container. Credential bytes are never written into generated YAML, and normal or
failed shutdown removes the file with the session directory.

## Boundary

`remote-llm` reads only its explicit owner-only remote administrator-key file and rejects reuse of a
local provider-key path. `simulated-llm` reads no model credential and starts no LiteLLM container.
This package selects model transport inputs; it does not own model authorization or product routing.

## See also

- Parent app: [LiteLLM](../README.md)
- Current model catalogue: [model routing](../../../../libs/backend/server/gateways/model-routing/main/README.md)
- Local development guide: [website/contributing/local-development.md](../../../../website/contributing/local-development.md)
