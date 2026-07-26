import { describe, expect, it } from "vitest";

import type { AttemptModelKeyIssuer, AttemptModelKeyMintRequest, MintedAttemptModelKey } from "../run-dispatch.types.js";

/**
 * Attempt-scoped LiteLLM credential rejection proofs (Phase E slice 4).
 *
 * These prove the SECURITY ENVELOPE of the attempt-scoped virtual key minted by the slice-2 claim
 * path ({@link AttemptModelKeyIssuer}, wired to the model-routing gateway in `apps/opencrane`).
 * They run against a MOCK credential authority that stands in for LiteLLM's key enforcement — never a
 * live endpoint — so the invariants hold offline. The live-LiteLLM leg is gated on #337 (ADR 0010).
 *
 * Each proof mints a key bound to exactly one attempt (alias), model alias, silo, budget, and expiry,
 * then presents a call and asserts the authority refuses it unless every dimension still matches.
 */

/** One presented model call the credential authority must authorize before it reaches a provider. */
interface PresentedModelCall
{
	/** Opaque virtual key the runtime presents (never the master key). */
	readonly key: string;
	/** Attempt key alias the calling attempt expects the key to be bound to. */
	readonly expectedKeyAlias: string;
	/** Model alias the call targets. */
	readonly modelAlias: string;
	/** Silo the call originates from. */
	readonly siloId: string;
	/** Incremental US-dollar cost this call would add to the key's cumulative spend. */
	readonly costUsd: number;
	/** Wall-clock instant of the call in epoch milliseconds. */
	readonly nowEpochMs: number;
}

/** Authorization outcome mirroring LiteLLM's allow / deny decision for a virtual key. */
type AuthorizationOutcome =
	| { readonly outcome: "allowed" }
	| { readonly outcome: "denied"; readonly reason: "alias_mismatch" | "model_not_permitted" | "silo_mismatch" | "expired" | "revoked" | "budget_exceeded" };

/**
 * Mock stand-in for LiteLLM's attempt-scoped virtual-key enforcement.
 *
 * `issue` records the immutable binding minted from an {@link AttemptModelKeyMintRequest}; `authorize`
 * refuses any presented call that drifts from that binding, and `revoke` models an out-of-band kill.
 */
class MockLiteLlmCredentialAuthority
{
	private readonly bindings = new Map<string, { keyAlias: string; modelAlias: string; siloId: string; maxBudgetUsd: number; expiresAtEpochMs: number; revoked: boolean; spentUsd: number }>();
	private issued = 0;
	private readonly nowEpochMs: number;

	/** Anchors minted expiries to a fixed clock so expiry proofs are deterministic. */
	constructor(nowEpochMs: number)
	{
		this.nowEpochMs = nowEpochMs;
	}

	/** Mint one transient key bound to the exact attempt alias, model, silo, budget, and lifetime. */
	issue(request: AttemptModelKeyMintRequest): MintedAttemptModelKey
	{
		this.issued += 1;
		const key = `sk-attempt-${this.issued}`;
		this.bindings.set(key, { keyAlias: request.keyAlias, modelAlias: request.modelAlias, siloId: request.siloId, maxBudgetUsd: request.maxBudgetUsd, expiresAtEpochMs: this.nowEpochMs + request.expirySeconds * 1000, revoked: false, spentUsd: 0 });
		return { key };
	}

	/** Model an out-of-band revocation of an already-minted key. */
	revoke(key: string): void
	{
		const binding = this.bindings.get(key);
		if (binding) binding.revoked = true;
	}

	/** Authorize a presented call, accruing spend only when every dimension still matches. */
	authorize(call: PresentedModelCall): AuthorizationOutcome
	{
		const binding = this.bindings.get(call.key);
		if (!binding || binding.keyAlias !== call.expectedKeyAlias) return { outcome: "denied", reason: "alias_mismatch" };
		if (binding.revoked) return { outcome: "denied", reason: "revoked" };
		if (call.nowEpochMs >= binding.expiresAtEpochMs) return { outcome: "denied", reason: "expired" };
		if (call.siloId !== binding.siloId) return { outcome: "denied", reason: "silo_mismatch" };
		if (call.modelAlias !== binding.modelAlias) return { outcome: "denied", reason: "model_not_permitted" };
		if (binding.spentUsd + call.costUsd > binding.maxBudgetUsd) return { outcome: "denied", reason: "budget_exceeded" };
		binding.spentUsd += call.costUsd;
		return { outcome: "allowed" };
	}
}

/** Build one representative mint request shaped exactly like the slice-2 claim path produces. */
function _MintRequest(overrides: Partial<AttemptModelKeyMintRequest> = {}): AttemptModelKeyMintRequest
{
	return { keyAlias: "attempt-0123456789abcdef0123456789abcdef", modelAlias: "silo-default", siloId: "silo-a", maxBudgetUsd: 5, expirySeconds: 900, ...overrides };
}

/** Build one in-scope call matching a mint request; individual proofs mutate a single dimension. */
function _CallFor(key: string, request: AttemptModelKeyMintRequest, overrides: Partial<PresentedModelCall> = {}): PresentedModelCall
{
	return { key, expectedKeyAlias: request.keyAlias, modelAlias: request.modelAlias, siloId: request.siloId, costUsd: 1, nowEpochMs: 1_000, ...overrides };
}

describe("attempt-scoped LiteLLM credential rejection", function _Suite()
{
	it("is bound through the real AttemptModelKeyIssuer port and authorizes an in-scope call", function _AllowsInScope()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const issuer: AttemptModelKeyIssuer = async function _issue(request) { return authority.issue(request); };
		return issuer(_MintRequest()).then(function _authorize(minted)
		{
			expect(authority.authorize(_CallFor(minted.key, _MintRequest()))).toEqual({ outcome: "allowed" });
		});
	});

	it("rejects an unapproved model alias not frozen into the snapshot route", function _RejectsAlias()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const minted = authority.issue(_MintRequest());
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { modelAlias: "gpt-premium" }))).toEqual({ outcome: "denied", reason: "model_not_permitted" });
	});

	it("rejects a cross-attempt key alias and a cross-silo presentation", function _RejectsCrossAttemptAndSilo()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const minted = authority.issue(_MintRequest());
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { expectedKeyAlias: "attempt-ffffffffffffffffffffffffffffffff" }))).toEqual({ outcome: "denied", reason: "alias_mismatch" });
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { siloId: "silo-b" }))).toEqual({ outcome: "denied", reason: "silo_mismatch" });
	});

	it("rejects a call after the attempt key lifetime expires", function _RejectsExpiry()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const minted = authority.issue(_MintRequest({ expirySeconds: 10 }));
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { nowEpochMs: 1_000 + 11_000 }))).toEqual({ outcome: "denied", reason: "expired" });
	});

	it("rejects a call once the attempt key is revoked", function _RejectsRevocation()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const minted = authority.issue(_MintRequest());
		authority.revoke(minted.key);
		expect(authority.authorize(_CallFor(minted.key, _MintRequest()))).toEqual({ outcome: "denied", reason: "revoked" });
	});

	it("rejects the call that would push cumulative spend over the frozen budget", function _RejectsOverBudget()
	{
		const authority = new MockLiteLlmCredentialAuthority(1_000);
		const minted = authority.issue(_MintRequest({ maxBudgetUsd: 3 }));
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { costUsd: 2 }))).toEqual({ outcome: "allowed" });
		expect(authority.authorize(_CallFor(minted.key, _MintRequest(), { costUsd: 2 }))).toEqual({ outcome: "denied", reason: "budget_exceeded" });
	});
});
