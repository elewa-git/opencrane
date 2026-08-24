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

## Boundary

Alternative B uses an explicitly configured remote LiteLLM endpoint and does not read this profile.
Alternative C starts no LiteLLM process and reads neither this profile nor provider credentials.

## See also

- Parent app: [LiteLLM](../README.md)
- Database owner: [PostgreSQL](../../../postgres/README.md)
