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

  it("marks an aborted fixed-name PATCH uncertain without an opposite mutation", async function _UncertainPatch()
  {
    const fetch = vi.fn().mockRejectedValue(new Error("request aborted before response"));
    vi.stubGlobal("fetch", fetch);

    await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
    expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
  });

	it("creates only after PATCH confirms the fixed credential is absent", async function _CreateAfterConfirmedAbsence()
	{
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response("missing", { status: 404 }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "POST"]);
	});

	it("marks an aborted POST uncertain after confirmed absence", async function _UncertainCreate()
	{
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response("missing", { status: 404 }))
			.mockRejectedValueOnce(new Error("request aborted before response"));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "POST"]);
	});

	it("keeps the desired key when a delayed first PATCH lands after its exact retry", async function _DelayedPatch()
	{
		let storedKey = "sk-old";
		let applyDelayed: (() => void) | null = null;
		let patchCount = 0;
		const fetch = vi.fn(async function _Fetch(_url: string, init?: RequestInit): Promise<Response>
		{
			if (init?.method !== "PATCH")
				throw new Error("credential rotation must not issue an opposite mutation");
			const body = JSON.parse(init.body as string) as { credential_values: { api_key: string } };
			patchCount += 1;
			if (patchCount === 1)
			{
				applyDelayed = function _ApplyDelayed() { storedKey = body.credential_values.api_key; };
				throw new Error("request timed out while upstream continued");
			}
			storedKey = body.credential_values.api_key;
			return new Response("{}", { status: 200 });
		});
		vi.stubGlobal("fetch", fetch);
		const desired = { credentialName: "byok-openai", provider: "openai", apiKey: "sk-desired" };

		await expect(_UpsertLiteLlmCredential(desired)).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		await expect(_UpsertLiteLlmCredential(desired)).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		applyDelayed!();

		expect(storedKey).toBe("sk-desired");
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "PATCH"]);
	});

  it("marks an aborted fixed-name delete uncertain", async function _UncertainDelete()
  {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request aborted before response")));

    await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
  });
});
