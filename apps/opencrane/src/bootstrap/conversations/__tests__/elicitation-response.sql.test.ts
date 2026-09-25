import { AgentRunState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, OrgMemberStatus, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { ElicitationBodyKinds } from "@opencrane/contracts";
import { PrismaConversationElicitationAccessRepository } from "@opencrane/backend/server/conversations";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { _ElicitationSqlPeer, _GrantElicitationSqlPeerConversationAccess, _ResolveElicitationSqlRequest, _SaveElicitationSqlResponse, _SeedElicitationSqlChild, _SeedElicitationSqlFixture } from "./elicitation-response.sql-fixture";

const _DATABASE = new PrismaClient();

describe("collaborative clarification authority on PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The clarification SQL proof requires DATABASE_URL and the fresh target baseline");
		await _DATABASE.$connect();
	});
	afterAll(async function _Disconnect() { await _DATABASE.$disconnect(); });

	it("records an active peer as the actual winner without replacing the original addressee", async function _PeerWinner()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		const response = await _ResolveElicitationSqlRequest(_DATABASE, request.id, peer);
		expect(await _DATABASE.elicitationRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ assignedParticipantId: request.assignedParticipantId, resolvedBy: peer, resolvedAt: response.submittedAt, state: ElicitationRequestState.Answered });
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } })).toBe(1);
	});

	it("revalidates current Use without recording another admission when the winner replays", async function _ReplayAuthority()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await _GrantElicitationSqlPeerConversationAccess(_DATABASE, request.siloId, request.conversationId, peer);
		const unit = new PrismaElicitationUnitOfWork(_DATABASE, null, function _ConversationAccess(transaction) { return new PrismaConversationElicitationAccessRepository(transaction); });
		const command = { siloId: request.siloId, conversationId: request.conversationId, requestId: request.id, subjectId: peer, verifiedStepUpAt: null, submission: { idempotencyKey: "peer-production-replay", response: { kind: ElicitationBodyKinds.FreeText, text: "Nakuru" } }, now: new Date() } as const;
		await expect(unit.respond(command)).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: false } });
		const durableAfterWinner = {
			responses: await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } }),
			deliveries: await _DATABASE.elicitationResultDelivery.count({ where: { requestId: request.id } }),
			admissions: await _DATABASE.auditDecision.count({ where: { siloId: request.siloId, actorId: peer, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: request.conversationId, action: ProductAuthorizationActions.Use } }),
		};
		await expect(unit.respond(command)).resolves.toMatchObject({ outcome: "accepted", projection: { idempotent: true } });
		const use = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Conversation, ProductAuthorizationActions.Use)!;
		const revoked = await _DATABASE.authorizationGrant.updateMany({ where: { siloId: request.siloId, subjectPrincipalId: peer, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: request.conversationId, capabilityId: use.capabilityId, revokedAt: null }, data: { revokedAt: new Date() } });
		expect(revoked.count).toBe(1);
		await expect(unit.respond(command)).resolves.toEqual({ outcome: "unauthorized" });
		expect({
			responses: await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } }),
			deliveries: await _DATABASE.elicitationResultDelivery.count({ where: { requestId: request.id } }),
			admissions: await _DATABASE.auditDecision.count({ where: { siloId: request.siloId, actorId: peer, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: request.conversationId, action: ProductAuthorizationActions.Use } }),
		}).toEqual(durableAfterWinner);
		expect(await _DATABASE.agentRun.findUniqueOrThrow({ where: { id: request.runId } })).toMatchObject({ state: AgentRunState.Running });
	});

	it("leaves one durable winner when two current participants answer concurrently", async function _ConcurrentWinner()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		const results = await Promise.allSettled([_ResolveElicitationSqlRequest(_DATABASE, request.id, peer), _ResolveElicitationSqlRequest(_DATABASE, request.id, request.assignedParticipantId)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
		const attempts = await _DATABASE.elicitationResponseAttempt.findMany({ where: { requestId: request.id } });
		expect(attempts).toHaveLength(1);
		expect(await _DATABASE.elicitationRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ resolvedBy: attempts[0]!.respondingSubjectId, resolvedAt: attempts[0]!.submittedAt, state: ElicitationRequestState.Answered });
	});

	it.each([ElicitationPurpose.ToolApproval, ElicitationPurpose.PersonalMemoryPermission, ElicitationPurpose.A2uiAction])("keeps %s assigned-only despite active peer access", async function _ProtectedPurpose(purpose)
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE, purpose);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, peer)).rejects.toThrow(/current participant or step-up authority/u);
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } })).toBe(0);
	});

	it("rejects a removed child participant who remains an active organization member", async function _RemovedParticipant()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await _DATABASE.conversationParticipant.update({ where: { conversationId_userId: { conversationId: request.conversationId, userId: peer } }, data: { accessEndedPosition: 1n } });
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, peer)).rejects.toThrow(/current participant or step-up authority/u);
	});

	it("rejects a suspended organization member who still has a participant row", async function _SuspendedMembership()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await _DATABASE.orgMembership.update({ where: { clusterTenant_subject: { clusterTenant: request.siloId, subject: peer } }, data: { status: OrgMemberStatus.Suspended } });
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, peer)).rejects.toThrow(/current organization membership/u);
	});

	it("rejects organization membership without exact conversation participation", async function _OrganizationOnly()
	{
		const { request } = await _SeedElicitationSqlFixture(_DATABASE);
		const outsider = await _ElicitationSqlPeer(_DATABASE, request.siloId, null);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, outsider)).rejects.toThrow(/current participant or step-up authority/u);
	});

	it("rejects a fresh response when its run no longer waits for input", async function _StaleRun()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await _DATABASE.agentRun.update({ where: { id: request.runId }, data: { state: AgentRunState.Running } });
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, peer)).rejects.toThrow(/exact current waiting run/u);
	});

	it("does not permit rebinding a request to another attempt or changing the saved winner", async function _ImmutableResolution()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await expect(_DATABASE.elicitationRequest.update({ where: { id: request.id }, data: { attempt: request.attempt + 1 } })).rejects.toThrow(/authority coordinates are immutable/u);
		const response = await _ResolveElicitationSqlRequest(_DATABASE, request.id, peer);
		await expect(_DATABASE.elicitationRequest.update({ where: { id: request.id }, data: { resolvedBy: request.assignedParticipantId } })).rejects.toThrow(/resolve exactly once/u);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, request.id, request.assignedParticipantId)).rejects.toThrow(/current participant or step-up authority/u);
		await _DATABASE.agentRun.update({ where: { id: request.runId }, data: { state: AgentRunState.Running } });
		expect(await _DATABASE.elicitationResponseAttempt.findUniqueOrThrow({ where: { id: response.id } })).toEqual(response);
	});

	it("admits a ready child peer only within its explicit source audience", async function _ChildPeer()
	{
		const seeded = await _SeedElicitationSqlFixture(_DATABASE);
		await _SeedElicitationSqlChild(_DATABASE, seeded);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, seeded.request.id, seeded.peer)).resolves.toMatchObject({ respondingSubjectId: seeded.peer });
	});

	it("rejects a parent and child participant omitted from the explicit child audience", async function _UninvitedChildPeer()
	{
		const seeded = await _SeedElicitationSqlFixture(_DATABASE);
		await _SeedElicitationSqlChild(_DATABASE, seeded, false);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, seeded.request.id, seeded.peer)).rejects.toThrow(/ready child and explicit audience/u);
	});

	it("rejects an unfinished child even when its frozen audience contains the peer", async function _PendingChild()
	{
		const seeded = await _SeedElicitationSqlFixture(_DATABASE);
		await _SeedElicitationSqlChild(_DATABASE, seeded, true, false);
		await expect(_ResolveElicitationSqlRequest(_DATABASE, seeded.request.id, seeded.peer)).rejects.toThrow(/ready child and explicit audience/u);
	});

	it("rejects lost parent access while child participation and membership remain active", async function _RevokedParent()
	{
		const seeded = await _SeedElicitationSqlFixture(_DATABASE);
		const { parent } = await _SeedElicitationSqlChild(_DATABASE, seeded);
		await _DATABASE.conversationParticipant.update({ where: { conversationId_userId: { conversationId: parent.id, userId: seeded.peer } }, data: { accessEndedPosition: 1n } });
		await expect(_ResolveElicitationSqlRequest(_DATABASE, seeded.request.id, seeded.peer)).rejects.toThrow(/current parent source visibility/u);
	});

	it("rejects resolution with no saved response", async function _NoResponse()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await expect(_DATABASE.elicitationRequest.update({ where: { id: request.id }, data: { state: ElicitationRequestState.Answered, resolvedBy: peer, resolvedAt: new Date() } })).rejects.toThrow(/exactly one saved response/u);
	});

	it("rejects two saved responses in one attempted resolution", async function _AmbiguousWinner()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await expect(_DATABASE.$transaction(async function _TwoResponses(transaction)
		{
			const now = new Date();
			await _SaveElicitationSqlResponse(transaction, request.id, peer, now);
			await _SaveElicitationSqlResponse(transaction, request.id, request.assignedParticipantId, now);
			await transaction.elicitationRequest.update({ where: { id: request.id }, data: { state: ElicitationRequestState.Answered, resolvedBy: peer, resolvedAt: now } });
		})).rejects.toThrow(/exactly one saved response/u);
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } })).toBe(0);
	});

	it.each(["actor", "time", "disposition"])("rejects a resolution that changes its saved response %s", async function _MismatchedWinner(coordinate)
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE);
		await expect(_DATABASE.$transaction(async function _WrongResolution(transaction)
		{
			const now = new Date();
			await _SaveElicitationSqlResponse(transaction, request.id, peer, now);
			await transaction.elicitationRequest.update({ where: { id: request.id }, data: {
				state: coordinate === "disposition" ? ElicitationRequestState.Declined : ElicitationRequestState.Answered,
				resolvedBy: coordinate === "actor" ? request.assignedParticipantId : peer,
				resolvedAt: coordinate === "time" ? new Date(now.getTime() + 1) : now,
			} });
		})).rejects.toThrow(/saved responder, time and disposition/u);
		expect(await _DATABASE.elicitationResponseAttempt.count({ where: { requestId: request.id } })).toBe(0);
	});

	it("records an explicit clarification decline under its actual responder", async function _PeerDecline()
	{
		const { request, peer } = await _SeedElicitationSqlFixture(_DATABASE, ElicitationPurpose.RuntimeInput, ElicitationBodyKind.Approval);
		const response = await _ResolveElicitationSqlRequest(_DATABASE, request.id, peer, false);
		expect(await _DATABASE.elicitationRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ state: ElicitationRequestState.Declined, resolvedBy: peer, resolvedAt: response.submittedAt });
	});
});
