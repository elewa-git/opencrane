# Local LiteLLM profile

> [apps](../../../README.md) › [_infra](../../README.md) › [litellm](../README.md) › local development

## What it owns

This directory owns the generated local LiteLLM profiles used by Tier 2 Alternative A. The reviewed
provider and model vocabulary lives in
[`@opencrane/models/local-development`](../../../../libs/models/local-development/main/provider-contract.json).
The coordinator turns the selected registry entry into secret-free `*.generated.yaml`, ignored by
Git, and mounts only that selected file read-only into the multi-platform image pinned by digest.

The provider key and LiteLLM master key stay separate. The configuration reads only the provider
key; the coordinator generates and supplies the master key independently. LiteLLM stores its virtual
keys in a separate `litellm` database inside the Tier 2 PostgreSQL container. Both containers share
only the labelled local-development Docker network; the application database remains `opencrane`.

Provider files follow `keys/<lowercase-provider-name>-key`, except that OpenAI retains its default
`keys/.openai-key`. The current registry recognizes Anthropic, Gemini, Mistral, and OpenAI. An exact
`--model` registry entry selects its provider; without that option, the first recognized filename in
sorted order selects its provider's default model.

The coordinator creates only the selected model's secret-free configuration when it is absent,
keeps OpenCrane's public model alias as `auto`, mounts only that configuration, and supplies only the
selected provider key through `OPENCRANE_LOCAL_PROVIDER_KEY`. Matching generated files are validated
and reused on later runs; they remain after shutdown and never contain credentials. Tests prove
deterministic selection, explicit default-model selection, model/provider matching, environment
isolation, owner-only provider-key permissions, symbolic-link rejection, and credential separation.

Adding another local provider requires a reviewed registry entry and matching tests. A conventional
filename alone grants no provider or model authority.

## Boundary

Alternative B uses an explicitly configured remote LiteLLM endpoint and does not read this profile.
Alternative C starts no LiteLLM process and reads neither this profile nor provider credentials.

## See also

- Parent app: [LiteLLM](../README.md)
- Database owner: [PostgreSQL](../../../postgres/README.md)
