import { McpExecutionTransport, OrgMemberStatus, PrincipalProvenance, Prisma, PrismaClient, ToolApprovalScopeState, type ToolApprovalScope } from "@prisma/client";
import { ToolApprovalScopeStates, type ToolApprovalScopeSummary } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___ExecutionSubjectSchema } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { __DigestCanonicalJson } from "../authority/canonical-json-digest";
import { PrismaAuthorizationAuthority } from "../authority/persistence/prisma-authorization-authority";
import { PrismaToolInvocationRepository } from "../tool-invocations/persistence/prisma-tool-invocation-repository";
import { __ReconcileToolApprovalScopeGrants } from "./tool-approval-scope-grants";
import type { ApplyStandingToolApprovalCommand, CreateToolApprovalScopeCommand, RevokeToolApprovalScopeResult, ToolApprovalScopeAuthority, ToolApprovalScopeCaller, ToolApprovalScopePage } from "./tool-approval-scope.types";

const _PAGE_SIZE = 100;

/** Map a durable scope to its intentionally limited public disclosure. */
function _Summary(scope: ToolApprovalScope): ToolApprovalScopeSummary
{
	return {
		id: scope.id,
		state: scope.state === ToolApprovalScopeState.Active ? ToolApprovalScopeStates.Active : ToolApprovalScopeStates.Revoked,
		action: scope.actionLabel,
		target: scope.targetLabel,
		...(scope.externalSystemLabel === null ? {} : { externalSystem: scope.externalSystemLabel }),
		...(scope.assistantLabel === null ? {} : { assistantLabel: scope.assistantLabel }),
		connectionOwnerLabel: scope.connectionOwnerLabel,
		createdAt: scope.createdAt.toISOString(),
		...(scope.revokedAt === null ? {} : { revokedAt: scope.revokedAt.toISOString() }),
	};
}

/** Transaction-bound persistence for exact standing scopes and their one-use admissions. */
export class PrismaToolApprovalScopeRepository implements ToolApprovalScopeAuthority
{
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Create one exact scope and its metadata-only owner grants in the approval transaction. */
	public async create(command: CreateToolApprovalScopeCommand): Promise<ToolApprovalScope>
	{
	const transaction = this._transaction;
	const scopeIdentityDigest = __DigestCanonicalJson({ siloId: command.siloId, requesterPrincipalId: command.requesterPrincipalId, requesterSubjectId: command.requesterSubjectId, agentServiceId: command.agentServiceId, agentRevisionId: command.agentRevisionId, connectionId: command.connection.connectionId, connectionOwnerPrincipalId: command.connection.connectionOwnerPrincipalId, connectionGeneration: command.connection.connectionGeneration, connectionEndpointDigest: command.connection.connectionEndpointDigest, toolRevisionId: command.toolRevisionId, toolAction: "invoke", argumentsDigest: command.argumentsDigest, routineId: null, routineRevision: null });
	const existing = await transaction.toolApprovalScope.findUnique({ where: { sourceApprovalRequestId: command.approvalRequestId } });
	if (existing !== null)
	{
		if (existing.siloId !== command.siloId || existing.requesterPrincipalId !== command.requesterPrincipalId || existing.requesterSubjectId !== command.requesterSubjectId
			|| existing.agentServiceId !== command.agentServiceId || existing.agentRevisionId !== command.agentRevisionId || existing.toolRevisionId !== command.toolRevisionId
			|| existing.connectionId !== command.connection.connectionId || existing.connectionOwnerPrincipalId !== command.connection.connectionOwnerPrincipalId
			|| existing.connectionGeneration !== command.connection.connectionGeneration || existing.connectionEndpointDigest !== command.connection.connectionEndpointDigest
			|| existing.routineId !== null || existing.routineRevision !== null || existing.scopeIdentityDigest !== scopeIdentityDigest
			|| existing.argumentsDigest !== command.argumentsDigest || __DigestCanonicalJson(existing.reviewedArguments as JsonValue) !== __DigestCanonicalJson(command.arguments))
			throw new Error("standing approval source collision");
		return existing;
	}
	const scope = await transaction.toolApprovalScope.upsert({ where: { activeIdentityDigest: scopeIdentityDigest }, update: { activeIdentityDigest: scopeIdentityDigest }, create: {
		siloId: command.siloId,
		requesterPrincipalId: command.requesterPrincipalId,
		requesterSubjectId: command.requesterSubjectId,
		agentServiceId: command.agentServiceId,
		agentRevisionId: command.agentRevisionId,
		connectionId: command.connection.connectionId,
		connectionOwnerPrincipalId: command.connection.connectionOwnerPrincipalId,
		connectionGeneration: command.connection.connectionGeneration,
		connectionEndpointDigest: command.connection.connectionEndpointDigest,
		toolRevisionId: command.toolRevisionId,
		toolAction: "invoke",
		reviewedArguments: ___CloneCanonicalJson(command.arguments) as Prisma.InputJsonValue,
		argumentsDigest: command.argumentsDigest,
		routineId: null,
		routineRevision: null,
		actionLabel: command.actionLabel,
		targetLabel: command.targetLabel,
		externalSystemLabel: command.externalSystemLabel,
		assistantLabel: command.connection.assistantLabel,
		connectionOwnerLabel: command.connection.disclosure.ownerLabel,
		sourceApprovalRequestId: command.approvalRequestId,
		scopeIdentityDigest,
		activeIdentityDigest: scopeIdentityDigest,
		createdAt: command.now,
	} });
	if (scope.state !== ToolApprovalScopeState.Active || scope.siloId !== command.siloId || scope.requesterPrincipalId !== command.requesterPrincipalId || scope.requesterSubjectId !== command.requesterSubjectId
		|| scope.agentServiceId !== command.agentServiceId || scope.agentRevisionId !== command.agentRevisionId || scope.toolRevisionId !== command.toolRevisionId
		|| scope.connectionId !== command.connection.connectionId || scope.connectionOwnerPrincipalId !== command.connection.connectionOwnerPrincipalId
		|| scope.connectionGeneration !== command.connection.connectionGeneration || scope.connectionEndpointDigest !== command.connection.connectionEndpointDigest
		|| scope.routineId !== null || scope.routineRevision !== null || scope.argumentsDigest !== command.argumentsDigest
		|| __DigestCanonicalJson(scope.reviewedArguments as JsonValue) !== __DigestCanonicalJson(command.arguments))
		throw new Error("standing approval identity collision");
	await __ReconcileToolApprovalScopeGrants(transaction, command.siloId, scope.id, command.requesterPrincipalId, true, command.now);
	return scope;
	}

	/** Create explicit one-use evidence and release one exact matching invocation without human input. */
	public async apply(command: ApplyStandingToolApprovalCommand): Promise<boolean>
	{
	const transaction = this._transaction;
	const candidates = await transaction.toolApprovalScope.findMany({ where: {
		siloId: command.siloId,
		requesterPrincipalId: command.requesterPrincipalId,
		requesterSubjectId: command.requesterSubjectId,
		agentServiceId: command.agentServiceId,
		agentRevisionId: command.agentRevisionId,
		connectionId: command.connection.connectionId,
		connectionOwnerPrincipalId: command.connection.connectionOwnerPrincipalId,
		connectionGeneration: command.connection.connectionGeneration,
		connectionEndpointDigest: command.connection.connectionEndpointDigest,
		toolRevisionId: command.toolRevisionId,
		toolAction: "invoke",
		argumentsDigest: command.argumentsDigest,
		routineId: null,
		routineRevision: null,
		state: ToolApprovalScopeState.Active,
	}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
	const matches = candidates.filter(scope => __DigestCanonicalJson(scope.reviewedArguments as JsonValue) === __DigestCanonicalJson(command.arguments));
	if (matches.length === 0)
		return false;
	if (matches.length !== 1)
		throw new Error("ambiguous standing tool approval scope");
	const scope = matches[0]!;
	await transaction.toolApprovalAdmission.create({ data: { scopeId: scope.id, scopeRevision: scope.revision, toolInvocationId: command.invocationId, argumentsDigest: command.argumentsDigest, createdAt: command.now } });
	if (!await PrismaToolInvocationRepository.markStandingConsentApprovedInTransaction(transaction, command.invocationId, command.arguments, command.argumentsDigest))
		throw new Error("standing approval lost its awaiting invocation fence");
	return true;
	}

	/** Validate unrevoked standing evidence immediately before a provider claim. */
	public async validate(invocationId: string): Promise<boolean>
	{
	const transaction = this._transaction;
	const invocation = await transaction.toolInvocation.findUnique({ where: { id: invocationId }, include: { standingApprovalAdmission: { include: { scope: true } } } });
	const admission = invocation?.standingApprovalAdmission;
	if (invocation === null || admission === null || admission === undefined)
		return true;
	const tool = await transaction.mcpToolRevision.findUnique({ where: { id_siloId: { id: invocation.toolRevisionId, siloId: invocation.siloId } }, select: { serverRevision: { select: { transport: true, connectionId: true, connectionGeneration: true, connectionOwnerPrincipalId: true, endpointDigest: true } } } });
	if (tool === null)
		return false;
	const connection = tool.serverRevision;
	const executionSubject = ___ExecutionSubjectSchema.safeParse(invocation.authorizationExecutionSubject);
	const requester = executionSubject.success ? await transaction.principal.findUnique({ where: { id_siloId: { id: executionSubject.data.requester.requesterPrincipalId, siloId: invocation.siloId } }, select: { id: true, subject: true, provenance: true } }) : null;
	const connectionMatches = connection.transport === McpExecutionTransport.OciImage
		? connection.connectionId === null && connection.connectionGeneration === null && connection.connectionOwnerPrincipalId === null && connection.endpointDigest === null
			&& admission.scope.connectionId === null && admission.scope.connectionGeneration === null && admission.scope.connectionEndpointDigest === null && admission.scope.connectionOwnerPrincipalId === invocation.principalId
		: connection.transport === McpExecutionTransport.RemoteHttp && admission.scope.connectionId === connection.connectionId
			&& admission.scope.connectionGeneration === connection.connectionGeneration && admission.scope.connectionOwnerPrincipalId === connection.connectionOwnerPrincipalId
			&& admission.scope.connectionEndpointDigest === connection.endpointDigest && admission.scope.connectionOwnerPrincipalId === invocation.principalId;
	return invocation.approvalRequired && admission.consumedAt === null && admission.origin === "StandingConsent"
		&& connectionMatches && requester !== null && requester.provenance === PrincipalProvenance.External && requester.id === admission.scope.requesterPrincipalId && requester.subject === admission.scope.requesterSubjectId
		&& admission.scope.routineId === null && admission.scope.routineRevision === null
		&& admission.argumentsDigest === invocation.effectiveArgumentsDigest && admission.scopeRevision === admission.scope.revision
		&& admission.scope.state === ToolApprovalScopeState.Active && admission.scope.siloId === invocation.siloId
		&& admission.scope.agentServiceId === invocation.agentServiceId && admission.scope.agentRevisionId === invocation.agentRevisionId
		&& admission.scope.toolRevisionId === invocation.toolRevisionId && admission.scope.argumentsDigest === invocation.effectiveArgumentsDigest
		&& __DigestCanonicalJson(admission.scope.reviewedArguments as JsonValue) === __DigestCanonicalJson(invocation.effectiveArguments as JsonValue);
	}

	/** Consume one-use standing evidence after the claim CAS; failure rolls the shared transaction back. */
	public async consume(invocationId: string, claimFence: number, now: Date): Promise<void>
	{
	const transaction = this._transaction;
	const admission = await transaction.toolApprovalAdmission.findUnique({ where: { toolInvocationId: invocationId } });
	if (admission === null)
		return;
	const consumed = await transaction.toolApprovalAdmission.updateMany({ where: { id: admission.id, scopeRevision: admission.scopeRevision, consumedAt: null, scope: { is: { state: ToolApprovalScopeState.Active, revision: admission.scopeRevision } } }, data: { consumedAt: now, consumedClaimFence: claimFence } });
	if (consumed.count !== 1)
		throw new Error("standing approval was revoked before dispatch claim committed");
	}

	/** List one stable page after active membership, ownership, and central Read filtering. */
	public async list(caller: ToolApprovalScopeCaller, cursor: string | null, now: Date): Promise<ToolApprovalScopePage>
	{
			const transaction = this._transaction;
			const principalId = await this._requesterPrincipal(caller);
			if (principalId === null)
				return { scopes: [] };
			const rows = await transaction.toolApprovalScope.findMany({ where: { siloId: caller.siloId, requesterPrincipalId: principalId, requesterSubjectId: caller.subjectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }), take: _PAGE_SIZE + 1 });
			const visible = await new PrismaAuthorizationAuthority(this._transaction).listPrincipalEntitled({ siloId: caller.siloId, principalId, action: ProductAuthorizationActions.Read, resources: rows.map(row => ({ kind: ProductAuthorizationResourceKinds.ToolApprovalScope, id: row.id })), nowEpochMs: now.getTime() });
			const allowed = new Set(visible.map(resource => resource.id));
			const page = rows.slice(0, _PAGE_SIZE).filter(row => allowed.has(row.id));
			return { scopes: page.map(_Summary), ...(rows.length > _PAGE_SIZE ? { nextCursor: rows[_PAGE_SIZE - 1]!.id } : {}) };
	}

	/** Revoke once, preserving Read for exact replay while removing Revoke for future commands. */
	public async revoke(caller: ToolApprovalScopeCaller, scopeId: string, idempotencyKey: string, now: Date): Promise<RevokeToolApprovalScopeResult>
	{
			const transaction = this._transaction;
			const principalId = await this._requesterPrincipal(caller);
			if (principalId === null)
				return { outcome: "not_found" } as const;
			const scope = await transaction.toolApprovalScope.findUnique({ where: { id: scopeId } });
			if (scope === null || scope.siloId !== caller.siloId || scope.requesterPrincipalId !== principalId || scope.requesterSubjectId !== caller.subjectId)
				return { outcome: "not_found" } as const;
			const keyDigest = __DigestCanonicalJson(idempotencyKey);
			const commandDigest = __DigestCanonicalJson({ scopeId, idempotencyKey });
			const authorization = new PrismaAuthorizationAuthority(this._transaction);
			if (scope.state === ToolApprovalScopeState.Revoked)
			{
				if (scope.revocationIdempotencyDigest !== keyDigest || scope.revocationCommandDigest !== commandDigest)
					return { outcome: "conflict" } as const;
				const read = await authorization.decidePrincipal({ siloId: caller.siloId, principalId, resource: { kind: ProductAuthorizationResourceKinds.ToolApprovalScope, id: scope.id }, action: ProductAuthorizationActions.Read, nowEpochMs: now.getTime() });
				return read.outcome === AuthorizationDecisionOutcomes.Allow ? { outcome: "revoked", scope: _Summary(scope), idempotent: true } as const : { outcome: "forbidden" } as const;
			}
			const admitted = await authorization.admitPrincipal({ siloId: caller.siloId, principalId, actorKind: "user", actorId: principalId, resource: { kind: ProductAuthorizationResourceKinds.ToolApprovalScope, id: scope.id }, action: ProductAuthorizationActions.Revoke, argumentsDigest: commandDigest, nowEpochMs: now.getTime() });
			if (admitted.outcome !== AuthorizationDecisionOutcomes.Allow)
				return { outcome: "forbidden" } as const;
			const updated = await transaction.toolApprovalScope.updateMany({ where: { id: scope.id, state: ToolApprovalScopeState.Active, revision: scope.revision }, data: { state: ToolApprovalScopeState.Revoked, revision: { increment: 1 }, activeIdentityDigest: null, revocationIdempotencyDigest: keyDigest, revocationCommandDigest: commandDigest, revokedByPrincipalId: principalId, revokedAt: now } });
			if (updated.count !== 1)
				throw new Error("standing approval revocation lost its state fence");
			await __ReconcileToolApprovalScopeGrants(transaction, caller.siloId, scope.id, principalId, false, now);
			const revoked = await transaction.toolApprovalScope.findUniqueOrThrow({ where: { id: scope.id } });
			return { outcome: "revoked", scope: _Summary(revoked), idempotent: false } as const;
	}

	/** Resolve one unambiguous active external requester and active silo membership. */
	private async _requesterPrincipal(caller: ToolApprovalScopeCaller): Promise<string | null>
	{
		const principals = await this._transaction.principal.findMany({ where: { siloId: caller.siloId, subject: caller.subjectId, provenance: PrincipalProvenance.External }, select: { id: true }, take: 2 });
		const membership = await this._transaction.orgMembership.findFirst({ where: { clusterTenant: caller.siloId, subject: caller.subjectId, status: OrgMemberStatus.Active }, select: { id: true } });
		return principals.length === 1 && membership !== null ? principals[0]!.id : null;
	}
}

/** Root-client transaction owner for requester listing and revocation. */
export class PrismaToolApprovalScopeUnitOfWork implements ToolApprovalScopeAuthority
{
	public constructor(private readonly _prisma: PrismaClient) {}

	/** List one stable page in a serializable authorization transaction. */
	public async list(caller: ToolApprovalScopeCaller, cursor: string | null, now: Date): Promise<ToolApprovalScopePage>
	{
		return ___RunInPrismaUnitOfWork(this._prisma, function _List(transaction)
		{
			return __ListToolApprovalScopesInTransaction(transaction, caller, cursor, now);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "list tool approval scopes", attemptLimit: 3, timeout: 10_000 });
	}

	/** Revoke once in a serializable authorization transaction. */
	public async revoke(caller: ToolApprovalScopeCaller, scopeId: string, idempotencyKey: string, now: Date): Promise<RevokeToolApprovalScopeResult>
	{
		return ___RunInPrismaUnitOfWork(this._prisma, function _Revoke(transaction)
		{
			return __RevokeToolApprovalScopeInTransaction(transaction, caller, scopeId, idempotencyKey, now);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "revoke tool approval scope", attemptLimit: 3, timeout: 10_000 });
	}
}

/** Preserve the caller-owned approval transaction while using the registered repository. */
export async function __CreateToolApprovalScopeInTransaction(transaction: Prisma.TransactionClient, command: CreateToolApprovalScopeCommand): Promise<ToolApprovalScope>
{
	return new PrismaToolApprovalScopeRepository(transaction).create(command);
}

/** Preserve the caller-owned opening transaction while using the registered repository. */
export async function __ApplyStandingToolApprovalInTransaction(transaction: Prisma.TransactionClient, command: ApplyStandingToolApprovalCommand): Promise<boolean>
{
	return new PrismaToolApprovalScopeRepository(transaction).apply(command);
}

/** Preserve the caller-owned claim transaction while using the registered repository. */
export async function __ValidateStandingToolApprovalAdmissionInTransaction(transaction: Prisma.TransactionClient, invocationId: string): Promise<boolean>
{
	return new PrismaToolApprovalScopeRepository(transaction).validate(invocationId);
}

/** Preserve the caller-owned claim transaction while using the registered repository. */
export async function __ConsumeStandingToolApprovalAdmissionInTransaction(transaction: Prisma.TransactionClient, invocationId: string, claimFence: number, now: Date): Promise<void>
{
	await new PrismaToolApprovalScopeRepository(transaction).consume(invocationId, claimFence, now);
}

/** Bind requester listing to an existing serializable transaction. */
async function __ListToolApprovalScopesInTransaction(transaction: Prisma.TransactionClient, caller: ToolApprovalScopeCaller, cursor: string | null, now: Date): Promise<ToolApprovalScopePage>
{
	return new PrismaToolApprovalScopeRepository(transaction).list(caller, cursor, now);
}

/** Bind requester revocation to an existing serializable transaction. */
async function __RevokeToolApprovalScopeInTransaction(transaction: Prisma.TransactionClient, caller: ToolApprovalScopeCaller, scopeId: string, idempotencyKey: string, now: Date): Promise<RevokeToolApprovalScopeResult>
{
	return new PrismaToolApprovalScopeRepository(transaction).revoke(caller, scopeId, idempotencyKey, now);
}
