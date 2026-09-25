import { describe, expect, it, vi } from "vitest";

import { ElicitationApprovalGrantScope, ElicitationApprovalGrantState } from "@prisma/client";
import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, type ElicitationApprovalBody, type ElicitationResponseValue } from "@opencrane/contracts";

import { _ApprovalScopeIsOffered, _ApprovalScopeOf, _MemoryOfferedScopes } from "../elicitation-approval-grant";
import { PrismaApprovalGrantRepository } from "../prisma-elicitation-approval-grants";
import { _IsElicitationResponseValid } from "../elicitation-response";

const NOW = new Date("2026-08-11T10:00:00.000Z");

function _Body(overrides: Partial<ElicitationApprovalBody> = {}): ElicitationApprovalBody
{
	return { kind: ElicitationBodyKinds.Approval, prompt: "Allow this?", action: "Use personal memory", target: "Your saved memory", dataUse: "Use remembered facts only for this answer", consequence: "The agent answers using saved memory", ...overrides };
}

function _Answer(approved: boolean, scope?: ElicitationApprovalScopes): ElicitationResponseValue
{
	return scope === undefined ? { kind: ElicitationBodyKinds.Approval, approved } : { kind: ElicitationBodyKinds.Approval, approved, scope };
}

const COORDINATES = { siloId: "silo-1", purpose: ElicitationPurposes.PersonalMemoryPermission, subjectId: "user-1", resourceKind: "memory_dataset", resourceId: "dataset-1", action: "recall" } as const;

describe("approval scope rules", function _ScopeRules()
{
	it("treats a missing scope as once, so a client that never heard of scopes grants nothing", function _MissingScope()
	{
		expect(_ApprovalScopeOf(_Answer(true))).toBe(ElicitationApprovalScopes.Once);
	});

	it("reduces a denial to once however it was scoped, so refusing never leaves a grant", function _DenialScope()
	{
		expect(_ApprovalScopeOf(_Answer(false, ElicitationApprovalScopes.Always))).toBe(ElicitationApprovalScopes.Once);
	});

	it("keeps the chosen scope on an approval", function _ApprovedScope()
	{
		expect(_ApprovalScopeOf(_Answer(true, ElicitationApprovalScopes.Session))).toBe(ElicitationApprovalScopes.Session);
	});

	it("refuses a scope the question did not offer, so a client cannot widen its own answer", function _UnofferedScope()
	{
		const body = _Body({ offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Session] });
		expect(_ApprovalScopeIsOffered(body, _Answer(true, ElicitationApprovalScopes.Always))).toBe(false);
		expect(_IsElicitationResponseValid(body, _Answer(true, ElicitationApprovalScopes.Always))).toBe(false);
	});

	it("accepts an offered scope", function _OfferedScope()
	{
		const body = _Body({ offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Session] });
		expect(_IsElicitationResponseValid(body, _Answer(true, ElicitationApprovalScopes.Session))).toBe(true);
	});

	it("still accepts a plain approval on a body that offers no scopes at all", function _LegacyBody()
	{
		expect(_IsElicitationResponseValid(_Body(), _Answer(true))).toBe(true);
	});

	it("never lets a sensitive dataset be silenced for good", function _SensitiveScopes()
	{
		expect(_MemoryOfferedScopes(true)).not.toContain(ElicitationApprovalScopes.Always);
		expect(_MemoryOfferedScopes(false)).toContain(ElicitationApprovalScopes.Always);
	});
});

describe("approval grant persistence", function _GrantPersistence()
{
	it("writes an always grant with no conversation, so it matches every conversation", async function _MintAlways()
	{
		const upsert = vi.fn().mockResolvedValue({});
		const transaction = { elicitationApprovalGrant: { upsert } } as never;

		await expect(new PrismaApprovalGrantRepository(transaction).mint({ ...COORDINATES, scope: ElicitationApprovalScopes.Always, conversationId: "conversation-1", requestId: "request-1", expiresAt: null })).resolves.toBe(true);
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { grantedFromId: "request-1" }, create: expect.objectContaining({ scope: ElicitationApprovalGrantScope.Always, conversationId: null }) }));
	});

	it("refuses a session grant with no conversation, which would silently behave as always", async function _MintSessionWithoutConversation()
	{
		const upsert = vi.fn();
		const transaction = { elicitationApprovalGrant: { upsert } } as never;

		await expect(new PrismaApprovalGrantRepository(transaction).mint({ ...COORDINATES, scope: ElicitationApprovalScopes.Session, conversationId: null, requestId: "request-1", expiresAt: null })).resolves.toBe(false);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("keys the write on the originating request so a replayed answer leaves one grant", async function _MintIsIdempotent()
	{
		const upsert = vi.fn().mockResolvedValue({});
		const transaction = { elicitationApprovalGrant: { upsert } } as never;

		await new PrismaApprovalGrantRepository(transaction).mint({ ...COORDINATES, scope: ElicitationApprovalScopes.Session, conversationId: "conversation-1", requestId: "request-1", expiresAt: null });
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
	});

	it("looks for a live grant matching this conversation or any conversation", async function _FindLive()
	{
		const findFirst = vi.fn().mockResolvedValue({ id: "grant-1", scope: ElicitationApprovalGrantScope.Always });
		const transaction = { elicitationApprovalGrant: { findFirst } } as never;

		await expect(new PrismaApprovalGrantRepository(transaction).findLive(COORDINATES, "conversation-1", NOW)).resolves.toEqual({ id: "grant-1", scope: ElicitationApprovalScopes.Always });
		const where = findFirst.mock.calls[0][0].where;
		expect(where.state).toBe(ElicitationApprovalGrantState.Active);
		expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: NOW } }]);
		expect(where.AND).toEqual([{ OR: [{ scope: ElicitationApprovalGrantScope.Always }, { scope: ElicitationApprovalGrantScope.Session, conversationId: "conversation-1" }] }]);
	});

	it("revokes only an active grant belonging to the subject asking", async function _Revoke()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { elicitationApprovalGrant: { updateMany } } as never;

		await expect(new PrismaApprovalGrantRepository(transaction).revoke("silo-1", "user-1", "grant-1", NOW)).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "grant-1", siloId: "silo-1", subjectId: "user-1", state: ElicitationApprovalGrantState.Active } }));
	});

	it("reports no revocation when the grant was already revoked or belongs to someone else", async function _RevokeMiss()
	{
		const transaction = { elicitationApprovalGrant: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never;
		await expect(new PrismaApprovalGrantRepository(transaction).revoke("silo-1", "user-1", "grant-1", NOW)).resolves.toBe(false);
	});
});
