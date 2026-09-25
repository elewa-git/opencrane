import { randomUUID } from "node:crypto";

import { AgentRunState, AgentServiceKind, ConversationChildRequestState, ConversationMode, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, OrgRole, PrincipalProvenance, Prisma, type PrismaClient } from "@prisma/client";

import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Seed a real waiting run and an ordinary clarification without bypassing baseline guards. */
export async function _SeedElicitationSqlFixture(prisma: PrismaClient, purpose: ElicitationPurpose = ElicitationPurpose.RuntimeInput, bodyKind: ElicitationBodyKind = ElicitationBodyKind.FreeText, modelInput = false, responseWindowMs = 120_000)
{
	const fixture = await _SeedConversationToolProposalSqlFixture({ agentKind: AgentServiceKind.Managed });
	const peer = await _ElicitationSqlPeer(prisma, fixture.siloId, fixture.turn.binding.conversationId);
	await prisma.agentRun.update({ where: { id: fixture.runId }, data: { state: AgentRunState.WaitingForInput } });
	const body: JsonValue = bodyKind === ElicitationBodyKind.Approval
		? { kind: "approval", prompt: "Use this analysis scope?", proposedArguments: { warehouse: "Nakuru" } }
		: { kind: "free_text", prompt: "Which warehouse should be counted?", maximumLength: 100, allowEmpty: false };
	const requestId = randomUUID();
	const requestKey = randomUUID();
	const purposePayload: JsonValue = modelInput ? { siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, runId: fixture.runId, attempt: 1, requestId, requestKey, bootstrapId: randomUUID(), modelOrdinal: 1, modelInvocationFence: randomUUID(), compiledInputDigest: `sha256:${"a".repeat(64)}`, declaration: { payloadRef: randomUUID(), ciphertextDigest: `sha256:${"b".repeat(64)}` }, authorityExpiresAtEpochMs: Date.now() + 300_000 } : null;
	const request = await prisma.elicitationRequest.create({ data: {
		id: requestId,
		// Production supplies millisecond time; PostgreSQL's default can round ahead of its clock.
		createdAt: new Date(),
		siloId: fixture.siloId, conversationId: fixture.turn.binding.conversationId, runId: fixture.runId, attempt: 1,
		assignedParticipantId: fixture.requesterPrincipalId, requestKey, purpose, bodyKind,
		body, bodyDigest: ___DigestCanonicalJson(body), purposePayload: purposePayload ?? Prisma.DbNull, purposePayloadDigest: ___DigestCanonicalJson(purposePayload), expiresAt: new Date(Date.now() + responseWindowMs),
	} });
	return { fixture, request, peer };
}

/** Give a distinct active organization member optional exact conversation participation. */
export async function _ElicitationSqlPeer(prisma: PrismaClient, siloId: string, conversationId: string | null): Promise<string>
{
	const subjectId = randomUUID();
	await prisma.$transaction(async function _SeedPeer(transaction)
	{
		await transaction.principal.create({ data: { id: subjectId, siloId, issuer: "https://identity.example.test", subject: subjectId, provenance: PrincipalProvenance.External } });
		await transaction.orgMembership.create({ data: { clusterTenant: siloId, subject: subjectId, role: OrgRole.Member } });
		if (conversationId !== null)
			await transaction.conversationParticipant.create({ data: { conversationId, userId: subjectId, visibleFromPosition: 1n, readThroughPosition: 0n } });
	});
	return subjectId;
}

/** Give one explicit peer the current conversation rights exercised by production response admission. */
export async function _GrantElicitationSqlPeerConversationAccess(prisma: PrismaClient, siloId: string, conversationId: string, principalId: string): Promise<void>
{
	await prisma.$transaction(async function _GrantPeerAccess(transaction)
	{
		const resource = { kind: ProductAuthorizationResourceKinds.Conversation, id: conversationId } as const;
		const grants = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Use].map(function _Grant(action)
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action)!;
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId } as const;
		});
		await new PrismaManagedAuthorizationGrantRepository(transaction).reconcileManagedResourceGrants({ siloId, managerId: `elicitation-sql-peer-${principalId}`, resource, grants, now: new Date() });
	});
}

/** Attach an immutable, trigger-validated shared origin to the existing agent conversation. */
export async function _SeedElicitationSqlChild(prisma: PrismaClient, seeded: Awaited<ReturnType<typeof _SeedElicitationSqlFixture>>, includePeer = true, ready = true)
{
	const { fixture, request, peer } = seeded;
	const child = await prisma.conversation.findUniqueOrThrow({ where: { id: request.conversationId } });
	const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: request.runId } });
	const parent = await prisma.conversation.create({ data: { siloId: fixture.siloId, mode: ConversationMode.Group } });
	await prisma.conversationParticipant.createMany({ data: [fixture.requesterPrincipalId, peer].map(function _ParentParticipant(userId)
	{
		return { conversationId: parent.id, userId, visibleFromPosition: 1n, readThroughPosition: 0n };
	}) });
	const participantSubjectIds = includePeer ? [fixture.requesterPrincipalId, peer] : [fixture.requesterPrincipalId];
	const origin = await prisma.conversationChildRequest.create({ data: {
		id: randomUUID(), siloId: fixture.siloId, idempotencyKey: randomUUID(), parentConversationId: parent.id,
		parentMessageId: randomUUID(), parentMessagePosition: 1n, childConversationId: child.id, computerId: child.computerId!,
		requestedByPrincipalId: fixture.requesterPrincipalId, requesterSubjectId: fixture.requesterPrincipalId,
		requesterIssuer: "https://identity.example.test", requesterAuthenticatedAt: new Date(), agentServiceId: run.agentServiceId,
		agentRevisionId: run.agentRevisionId, agentIdentityId: child.computerAgentIdentityId!, agentPrincipalId: fixture.principalId,
		agentName: "SQL company assistant", profileRevisionId: child.computerProfileRevisionId!, participantSubjectIds,
		commandDigest: ___DigestCanonicalJson({ requestId: request.id, participantSubjectIds }),
	} });
	if (ready)
		await prisma.conversationChildRequest.update({ where: { id: origin.id }, data: { state: ConversationChildRequestState.Ready } });
	return { parent, origin };
}

/** Store the attempted answer using only the SQL authority boundary under test. */
export async function _SaveElicitationSqlResponse(transaction: Prisma.TransactionClient, requestId: string, subjectId: string, submittedAt: Date, approved?: boolean)
{
	const response: JsonValue = approved === undefined ? { kind: "free_text", text: "Nakuru" } : { kind: "approval", approved };
	return transaction.elicitationResponseAttempt.create({ data: {
		requestId, idempotencyKey: randomUUID(), respondingSubjectId: subjectId, response,
		responseDigest: ___DigestCanonicalJson(response), submittedAt,
	} });
}

/** Attempt one atomic response and terminal resolution; racing callers must leave one winner. */
export async function _ResolveElicitationSqlRequest(prisma: PrismaClient, requestId: string, subjectId: string, approved?: boolean)
{
	return prisma.$transaction(async function _Resolve(transaction)
	{
		const now = new Date();
		const response = await _SaveElicitationSqlResponse(transaction, requestId, subjectId, now, approved);
		const state = approved === false ? ElicitationRequestState.Declined : ElicitationRequestState.Answered;
		await transaction.elicitationRequest.update({ where: { id: requestId }, data: { state, resolvedAt: now, resolvedBy: subjectId } });
		return response;
	});
}
