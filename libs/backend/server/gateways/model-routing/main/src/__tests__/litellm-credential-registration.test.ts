import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "../core/litellm-credential-registration";
import { LiteLlmCredentialMutationOutcomes } from "../core/litellm-credential-registration.types";

describe("LiteLLM credential mutation outcomes", function _Suite()
{
  beforeEach(function _Configure()
  {
    process.env.LITELLM_ENDPOINT = "http://litellm:4000";
    process.env.LITELLM_MASTER_KEY = "master-key";
  });

  afterEach(function _Restore()
  {
    delete process.env.LITELLM_ENDPOINT;
    delete process.env.LITELLM_MASTER_KEY;
    vi.unstubAllGlobals();
  });

  it("marks an aborted fixed-name upsert uncertain and does not start the create after an uncertain delete", async function _UncertainUpsert()
  {
    const fetch = vi.fn().mockRejectedValue(new Error("request aborted before response"));
    vi.stubGlobal("fetch", fetch);

    await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("marks an aborted fixed-name delete uncertain", async function _UncertainDelete()
  {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request aborted before response")));

    await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
  });
});
