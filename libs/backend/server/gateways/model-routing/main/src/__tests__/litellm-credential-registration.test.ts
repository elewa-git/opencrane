import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const _MARK_ACTIVE_SPAN_FAILED = vi.hoisted(function _MarkActiveSpanFailed() { return vi.fn(); });

vi.mock("@opencrane/backend/observability", async function _Observability(importOriginal: () => Promise<typeof import("@opencrane/backend/observability")>)
{
	return { ...await importOriginal(), ___MarkActiveSpanFailed: _MARK_ACTIVE_SPAN_FAILED };
});

import { _DeleteLiteLlmCredential, _UpsertLiteLlmCredential } from "../core/litellm-credential-registration";
import { LiteLlmCredentialMutationOutcomes } from "../core/litellm-credential-registration.types";

describe("LiteLLM credential mutation outcomes", function _Suite()
{
  beforeEach(function _Configure()
  {
	  process.env.LITELLM_ENDPOINT = "http://litellm:4000";
	  process.env.LITELLM_MASTER_KEY = "master-key";
	  _MARK_ACTIVE_SPAN_FAILED.mockClear();
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
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("marks a rejected fixed-name PATCH span failed", async function _RejectedPatch()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rejected", { status: 500 })));

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Rejected);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("creates only after PATCH confirms the fixed credential is absent", async function _CreateAfterConfirmedAbsence()
	{
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response("missing", { status: 404 }))
			.mockResolvedValueOnce(_successResponse());
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "POST"]);
		expect(_MARK_ACTIVE_SPAN_FAILED).not.toHaveBeenCalled();
	});

	it("creates after the installed LiteLLM PATCH returns its missing-credential error inside HTTP 200", async function _ReturnedMissingCredential()
	{
		const fetch = vi.fn().mockResolvedValueOnce(_errorResponse("404")).mockResolvedValueOnce(_successResponse());
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "POST"]);
		expect(_MARK_ACTIVE_SPAN_FAILED).not.toHaveBeenCalled();
	});

	it.each(["401", "403", "500"])("rejects a returned PATCH error %s without creating a credential", async function _ReturnedPatchError(code)
	{
		const fetch = vi.fn().mockResolvedValue(_errorResponse(code));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Rejected);
		expect(fetch).toHaveBeenCalledOnce();
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it.each(["{}", "null", "[]", "invalid-json", '{"code":404}', '{"success":false}', '{"success":true,"code":"404"}', '{"code":"4040"}'])("leaves the PATCH outcome uncertain for an unconfirmed body %s", async function _UnconfirmedPatch(body)
	{
		const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		expect(fetch).toHaveBeenCalledOnce();
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("does not accept a returned POST error as a created credential", async function _ReturnedCreateError()
	{
		const fetch = vi.fn().mockResolvedValueOnce(_errorResponse("404")).mockResolvedValueOnce(_errorResponse("500"));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Rejected);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("keeps a malformed POST response and its parser error out of logs", async function _MalformedCreate()
	{
		const fetch = vi.fn().mockResolvedValueOnce(_errorResponse("404")).mockResolvedValueOnce(new Response('sk-private-response {', { status: 200 }));
		const warn = vi.fn();
		const logger = { warn } as never;
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" }, logger)).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		const fields = warn.mock.calls[0]?.[0] as { err: Error };
		expect(fields.err.message).not.toContain("sk-private-response");
		expect(fields.err.cause).toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("marks an aborted POST uncertain after confirmed absence", async function _UncertainCreate()
	{
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response("missing", { status: 404 }))
			.mockRejectedValueOnce(new Error("request aborted before response"));
		vi.stubGlobal("fetch", fetch);

		await expect(_UpsertLiteLlmCredential({ credentialName: "byok-openai", provider: "openai", apiKey: "sk-test" })).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "POST"]);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
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
			return _successResponse();
		});
		vi.stubGlobal("fetch", fetch);
		const desired = { credentialName: "byok-openai", provider: "openai", apiKey: "sk-desired" };

		await expect(_UpsertLiteLlmCredential(desired)).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		await expect(_UpsertLiteLlmCredential(desired)).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		applyDelayed!();

		expect(storedKey).toBe("sk-desired");
		expect(fetch.mock.calls.map(function _Method(call) { return (call[1] as RequestInit).method; })).toEqual(["PATCH", "PATCH"]);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

  it("marks an aborted fixed-name delete uncertain", async function _UncertainDelete()
  {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request aborted before response")));

	  await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
	  expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("marks a rejected fixed-name delete span failed", async function _RejectedDelete()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rejected", { status: 500 })));

		await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Rejected);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("confirms the explicit DELETE success response", async function _ConfirmedDelete()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_successResponse()));

		await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		expect(_MARK_ACTIVE_SPAN_FAILED).not.toHaveBeenCalled();
	});

	it("accepts a returned DELETE absence but rejects other returned errors", async function _ReturnedDeleteError()
	{
		const fetch = vi.fn().mockResolvedValueOnce(_errorResponse("404")).mockResolvedValueOnce(_errorResponse("500"));
		vi.stubGlobal("fetch", fetch);

		await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Applied);
		await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Rejected);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});

	it("leaves an unconfirmed DELETE body uncertain", async function _UnconfirmedDelete()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

		await expect(_DeleteLiteLlmCredential("byok-openai")).resolves.toBe(LiteLlmCredentialMutationOutcomes.Uncertain);
		expect(_MARK_ACTIVE_SPAN_FAILED).toHaveBeenCalledOnce();
	});
});

/** Uses the success fields returned by the installed credential endpoints. */
function _successResponse(): Response
{
	return new Response(JSON.stringify({ success: true, message: "Credential updated successfully" }), { status: 200 });
}

/** Reproduces the installed LiteLLM 1.81.0 ProxyException encoded through FastAPI's vars path. */
function _errorResponse(code: string): Response
{
	return new Response(JSON.stringify({ message: "Credential not found in DB.", type: "internal_server_error", param: "None", code, openai_code: Number(code), headers: {}, provider_specific_fields: null }), { status: 200 });
}
