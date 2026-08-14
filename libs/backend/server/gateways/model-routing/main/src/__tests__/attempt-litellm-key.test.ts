import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _IssueAttemptLiteLlmKey } from "../core/attempt-litellm-key";

/** Preserve and restore the LiteLLM env the issuer reads. */
const _saved: Record<string, string | undefined> = {};

/** Captured coordinates of the last fetch the issuer performed. */
const _captured: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };

/** Build a fetch double capturing the request and returning a minted key. */
function _fetchMock(response: { ok: boolean; status: number; body: unknown })
{
	return vi.fn(async function _fetch(url: string, init?: RequestInit): Promise<Response>
	{
		_captured.url = url;
		_captured.init = init;
		return new Response(JSON.stringify(response.body), { status: response.status });
	});
}

describe("_IssueAttemptLiteLlmKey", function _describeIssuer()
{
	beforeEach(function _configure()
	{
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) _saved[key] = process.env[key];
		process.env.LITELLM_ENDPOINT = "http://litellm.svc";
		process.env.LITELLM_MASTER_KEY = "sk-master";
	});

	afterEach(function _restore()
	{
		vi.unstubAllGlobals();
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) { if (_saved[key] === undefined) delete process.env[key]; else process.env[key] = _saved[key]; }
	});

	it("mints a key bound to the single model, budget, and expiry", async function _mints()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk-attempt-xyz" } });
		vi.stubGlobal("fetch", mock);

		const minted = await _IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600 });

		expect(minted).toEqual({ key: "sk-attempt-xyz", keyAlias: "attempt-run1-1", modelAlias: "silo-default", expirySeconds: 3600 });
		const body = JSON.parse(String(_captured.init?.body));
		expect(body.models).toEqual(["silo-default"]);
		expect(body.key_alias).toBe("attempt-run1-1");
		expect(body.max_budget).toBe(2);
		expect(body.duration).toBe("3600s");
		expect(_captured.url).toBe("http://litellm.svc/key/generate");
	});

	it("rejects an alias that is not attempt-scoped before calling LiteLLM", async function _rejectsAlias()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk" } });
		vi.stubGlobal("fetch", mock);

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "master", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600 })).rejects.toThrow(/attempt-scoped alias/);
		expect(mock).not.toHaveBeenCalled();
	});

	it("rejects an unbounded budget or expiry", async function _rejectsBounds()
	{
		vi.stubGlobal("fetch", _fetchMock({ ok: true, status: 200, body: { key: "sk" } }));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 0, expirySeconds: 3600 })).rejects.toThrow(/positive budget/);
		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 999_999 })).rejects.toThrow(/bounded positive expiry/);
	});

	it("fails hard when LiteLLM is unconfigured", async function _requiresConfig()
	{
		delete process.env.LITELLM_ENDPOINT;

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600 })).rejects.toThrow(/LITELLM_ENDPOINT/);
	});

	it("throws when LiteLLM returns no key", async function _requiresKey()
	{
		vi.stubGlobal("fetch", _fetchMock({ ok: true, status: 200, body: {} }));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600 })).rejects.toThrow(/returned no key/);
	});

	it("identifies invalid JSON before it can become an attempt key", async function _RejectsInvalidJson()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600 })).rejects.toThrow(/LiteLLM attempt key response must contain valid JSON/);
	});
});
