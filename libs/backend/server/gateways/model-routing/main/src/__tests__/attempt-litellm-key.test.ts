import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _IssueAttemptLiteLlmKey, _RevokeAttemptLiteLlmKeyByAlias } from "../core/attempt-litellm-key";

/** Preserve and restore the LiteLLM env the issuer reads. */
const _NOW = Date.parse("2026-09-07T12:00:00.000Z");
const _NOT_AFTER = "2026-09-07T13:00:00.000Z";
const _EXPIRES = "2026-09-07T12:59:50.000Z";

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
		vi.spyOn(Date, "now").mockReturnValue(_NOW);
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"]) _saved[key] = process.env[key];
		process.env.LITELLM_ENDPOINT = "http://litellm.svc";
		process.env.LITELLM_MASTER_KEY = "sk-master";
	});

	afterEach(function _restore()
	{
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		for (const key of ["LITELLM_ENDPOINT", "LITELLM_MASTER_KEY"])
		{
			if (_saved[key] === undefined)
				delete process.env[key];
			else
				process.env[key] = _saved[key];
		}
	});

	it("mints a key bound to the single model, budget, and expiry", async function _mints()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk-attempt-xyz", expires: _EXPIRES } });
		vi.stubGlobal("fetch", mock);

		const minted = await _IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER });

		expect(minted).toEqual({ key: "sk-attempt-xyz", keyAlias: "attempt-run1-1", modelAlias: "silo-default", expirySeconds: 3590, expiresAt: _EXPIRES });
		const body = JSON.parse(String(_captured.init?.body));
		expect(body.models).toEqual(["silo-default"]);
		expect(body.key_alias).toBe("attempt-run1-1");
		expect(body.max_budget).toBe(2);
		expect(body.duration).toBe("3590s");
		expect(body.budget_duration).toBeNull();
		expect(_captured.url).toBe("http://litellm.svc/key/generate");
	});

	it.each(["2026-09-07T13:00:01.000Z", "2026-09-07T11:59:59.000Z", "not-a-dateZ"])("revokes an issued key with unusable provider expiry %s", async function _RejectsProviderExpiry(expires)
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk-attempt-xyz", expires } });
		vi.stubGlobal("fetch", mock);
		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/expiry exceeds current authority/);
		expect(_captured.url).toBe("http://litellm.svc/key/delete");
		expect(JSON.parse(String(_captured.init?.body))).toEqual({ key_aliases: ["attempt-run1-1"] });
	});

	it("cleans up a minted key whose expiry is absent before any handoff", async function _MissingExpiry()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk-attempt-xyz" } });
		vi.stubGlobal("fetch", mock);
		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/explicit expiry/);
		expect(_captured.url).toBe("http://litellm.svc/key/delete");
	});

	it("refuses to mint when the remaining authority cannot cover bounded issuance", async function _ExpiredAuthority()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: {} });
		vi.stubGlobal("fetch", mock);
		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: "2026-09-07T12:00:05.000Z" })).rejects.toThrow(/authority expires/);
		expect(mock).not.toHaveBeenCalled();
	});

	it("rejects an alias that is not attempt-scoped before calling LiteLLM", async function _rejectsAlias()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: { key: "sk" } });
		vi.stubGlobal("fetch", mock);

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "master", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/attempt-scoped alias/);
		expect(mock).not.toHaveBeenCalled();
	});

	it("rejects an unbounded budget or expiry", async function _rejectsBounds()
	{
		vi.stubGlobal("fetch", _fetchMock({ ok: true, status: 200, body: { key: "sk" } }));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 0, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/positive budget/);
		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 999_999, notAfter: _NOT_AFTER })).rejects.toThrow(/bounded positive expiry/);
	});

	it("fails hard when LiteLLM is unconfigured", async function _requiresConfig()
	{
		delete process.env.LITELLM_ENDPOINT;

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/LITELLM_ENDPOINT/);
	});

	it("throws when LiteLLM returns no key", async function _requiresKey()
	{
		vi.stubGlobal("fetch", _fetchMock({ ok: true, status: 200, body: {} }));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/returned no key/);
	});

	it("revokes every uncertain mint under the exact attempt alias", async function _RevokesAlias()
	{
		const mock = _fetchMock({ ok: true, status: 200, body: {} });
		vi.stubGlobal("fetch", mock);
		await _RevokeAttemptLiteLlmKeyByAlias({ keyAlias: "attempt-run1-1" });
		expect(JSON.parse(String(_captured.init?.body))).toEqual({ key_aliases: ["attempt-run1-1"] });
		expect(_captured.url).toBe("http://litellm.svc/key/delete");
	});

	it("identifies invalid JSON before it can become an attempt key", async function _RejectsInvalidJson()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));

		await expect(_IssueAttemptLiteLlmKey({ keyAlias: "attempt-run1-1", modelAlias: "silo-default", maxBudgetUsd: 2, expirySeconds: 3600, notAfter: _NOT_AFTER })).rejects.toThrow(/LiteLLM attempt key response must contain valid JSON/);
	});
});
