# Local LiteLLM profile

> [OpenCrane](../../../../README.md) › [apps](../../../README.md) › [_infra](../../README.md) › [litellm](../README.md) › local development

## What it owns

This directory turns one provider and model from the production-owned BYOK catalogue into the
secret-free LiteLLM configuration used by Tier 2 `local-llm`. The public model name remains `auto`,
so the current server follows its normal compiled-model path while LiteLLM routes to the selected
upstream model.

The catalogue remains owned by the model-routing package through its public
`libs/backend/server/gateways/model-routing/main/byok-provider-catalog.json` artifact; this package
does not copy it or reach into private source. On a workstation, provider keys live outside this
package under `keys/.<provider>-key`. A key must be a non-symbolic regular file readable only by its
owner. When neither an explicit provider/model nor a configured default selects a provider, the
first recognized key filename in lexical order chooses its provider and that provider's reviewed
default model. On a workstation, `--default-provider <name>` validates the matching key file's path
and permissions and writes `OPENCRANE_TIER2_DEFAULT_PROVIDER=<name>` to the ignored, owner-only
`keys/.tier2-default-provider.env` file. Later workstation `local-llm` launches load that preference
automatically. An explicitly exported `OPENCRANE_TIER2_DEFAULT_PROVIDER` overrides the file without
rewriting it. The launcher updates only its worker environment; it cannot modify the parent shell.

The reviewed providers are `anthropic`, `deepseek`, `gemini`, `glm`, `mistral` and `openai`.
Workstation key filenames use these lowercase names. OpenCrane converts the selected provider to
its uppercase, space-free Codespaces credential prefix.

Mistral uses `mistral-medium-latest` by default because Studio subscription tiers may expose Medium
and Small while rejecting Large. An entitled workspace can still select Large explicitly with
`--model mistral/mistral-large-latest`.

Codespaces reads uppercase provider-specific variables such as `OPENAI_TIER2_PROVIDER_API_KEY` and
`ANTHROPIC_TIER2_PROVIDER_API_KEY`; it never reads workstation key files. An explicit provider or
model wins, followed by the configured default and then the first recognized variable in lexical
order. Add `OPENCRANE_TIER2_DEFAULT_PROVIDER` manually as a Codespaces secret when that preference
must survive a restart; `--default-provider` cannot update an account-owned Codespaces secret. An
explicit or default provider must have its matching secret. The coordinator removes all
matching credential variables before running validation or application child processes. Use
`--model` to override the selected provider's reviewed default; an unreviewed provider, model,
credential variable or cross-provider pairing is refused. The retired generic
`OPENCRANE_TIER2_PROVIDER_API_KEY` is therefore rejected rather than guessed.

The coordinator writes one session-owned YAML beside its other disposable secrets. It contains only
the `auto` alias, selected model, and `os.environ/OPENCRANE_LOCAL_PROVIDER_KEY` reference. The
coordinator supplies that one provider key and a separate disposable LiteLLM master key to the
loopback-bound container. On ARM Docker daemons, `--emulate-amd64` also runs LiteLLM through AMD64
emulation because the pinned ARM64 variant lacks the Prisma schema engine required to initialize its
key store. The coordinator also creates an isolated `litellm` database and non-privileged database
role with its own persistent credential in Tier 2's owned PostgreSQL service. LiteLLM needs that
database for the per-run virtual keys issued by the current Agent path;
the launch waits for authenticated key storage as well as model discovery before starting OpenCrane.
Credential bytes are never written into generated YAML or Docker arguments, and normal or failed
shutdown removes the generated file with the session directory. The Codespaces devcontainer
recommends every supported environment-secret name and the optional default-provider setting but
never stores their values in tracked configuration. Codespaces gets a 120-second LiteLLM readiness
window; a workstation keeps the 30-second window. The launcher stops waiting as soon as the
container exits. An early exit or timeout reports the container state and a bounded startup-log tail
after removing the provider key, LiteLLM master key and database password; it never prints the
container environment.

The pinned image includes its OpenAI tokenizer cache. Tier 2 points
`CUSTOM_TIKTOKEN_CACHE_DIR` at that bundled read-only directory so Codespaces startup does not
require DNS or outbound access to the Azure Blob Storage copy of `cl100k_base.tiktoken`.

## Boundary

`remote-llm` reads only its explicit owner-only remote administrator-key file and rejects reuse of a
local provider-key path. `simulated-llm` reads no model credential and starts no LiteLLM container.
This package selects model transport inputs; it does not own model authorization or product routing.

## See also

- Parent app: [LiteLLM](../README.md)
- Current model catalogue: [model routing](../../../../libs/backend/server/gateways/model-routing/main/README.md)
- Local development guide: [website/contributing/local-development.md](../../../../website/contributing/local-development.md)
