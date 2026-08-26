# Local LiteLLM profile

> [apps](../../../README.md) › [_infra](../../README.md) › [litellm](../README.md) › local development

## What it owns

This directory owns the reviewed LiteLLM model configuration used by Tier 2 Alternative A. The
coordinator mounts `config.yaml` read-only into a multi-platform image index pinned by digest before
supplying the OpenAI provider key through the container environment.

The provider key and LiteLLM master key stay separate. The configuration reads only the provider
key; the coordinator generates and supplies the master key independently. LiteLLM stores its virtual
keys in a separate `litellm` database inside the Tier 2 PostgreSQL container. Both containers share
only the labelled local-development Docker network; the application database remains `opencrane`.

The coordinator reads the provider key from `keys/.openai-key` by default. Pass
`--provider-key-file keys/openai-key` to use the `keys/<lowercase-provider-name>-key` convention.
Alternative A rejects paths outside `keys/`, uppercase names, and provider names that do not match
its reviewed OpenAI configuration. This option changes only credential custody. The reviewed local
configuration still routes the `auto` alias to its OpenAI model, so another provider belongs behind
Alternative B until a separate local provider/model configuration is reviewed.

Provider files use `keys/<lowercase-provider-name>-key`: for example, `keys/anthropic-key`,
`keys/gemini-key`, `keys/azure-openai-key`, or `keys/mistral-key`. These names describe credential
custody; they do not select a LiteLLM provider. The current parser admits only `keys/openai-key`.

Adding another local provider requires one provider-specific configuration in this directory that
keeps the public model alias `auto`, the matching parser allow-list entry, configuration selection,
and container environment mapping. Tests must prove the selected key never enters command arguments,
no unselected provider credential reaches the container, and the existing file-permission,
symbolic-link, and credential-separation checks still fail closed. Until that complete contract
lands, use Alternative B for non-OpenAI providers.

## Boundary

Alternative B uses an explicitly configured remote LiteLLM endpoint and does not read this profile.
Alternative C starts no LiteLLM process and reads neither this profile nor provider credentials.

## See also

- Parent app: [LiteLLM](../README.md)
- Database owner: [PostgreSQL](../../../postgres/README.md)
