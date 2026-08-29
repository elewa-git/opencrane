import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, type AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentService, type RevisionBoundaryAttachment } from "@opencrane/models/agents";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type AuthorizationBoundary, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { AgentRevisionLifecycleDenials } from "../agent-revision-lifecycle.types";
import type { AgentRevisionLifecycleRepository, AgentServiceHistory, AgentServiceReadCaller, AppendAgentRevisionResult, ChangeAgentServiceStateCommand, ChangeAgentServiceStateResult, CreateManagedAgentServiceCommand, CreateManagedAgentServiceResult, RestoreAgentRevisionCommand, ReviseAgentRevisionCommand } from "../agent-revision-lifecycle.types";
import { PrismaAgentRevisionLifecycleRepository } from "./prisma-agent-revision-lifecycle";

/**
 * Opens serializable transactions around managed-agent lifecycle persistence and authorization.
 *
 * The unit of work evaluates current management or read authority using the same transaction that
 * holds the lifecycle rows. A denial therefore prevents the repository write, while a successful
 * decision and its resource mutation commit together.
 *
 * Called by: `_CreateAgentServicesRouter` in `prisma-agent-services.router.ts`.
 *
 * @implements AgentRevisionLifecycleRepository
 */
export class PrismaAgentRevisionLifecycleUnitOfWork implements AgentRevisionLifecycleRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Builds the authority against the transaction that owns the lifecycle operation. */
	private readonly createAuthorization: ((transaction: Prisma.TransactionClient) => AuthorizationAuthority) | null;

	/**
	 * Creates the lifecycle unit of work over the OpenCrane database.
	 *
	 * The optional factory lets focused tests provide an authority without weakening production
	 * transaction ownership.
	 *
	 * @param prisma - Client that opens the serializable lifecycle transaction.
	 * @param createAuthorization - Optional test factory bound to the opened transaction.
	 */
	constructor(prisma: PrismaClient, createAuthorization: ((transaction: Prisma.TransactionClient) => AuthorizationAuthority) | null = null)
	{
		this.prisma = prisma;
		this.createAuthorization = createAuthorization;
	}

	/** Lists the managed services that the current Principal may discover. */
	listManagedServices(caller: AgentServiceReadCaller): Promise<readonly AgentService[]>
	{
		return this._Run(async function _List(repository, authorization)
		{
			const services = await repository.listManagedServices(caller);
			const resources = services.map(service => ({ kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }));
			const entitled = await _EntitledIds(authorization, caller, ProductAuthorizationActions.Discover, resources);
			return services.filter(service => entitled.has(service.id));
		});
	}

	/** Loads one service when the current Principal may read it. */
	getService(agentServiceId: string, caller: AgentServiceReadCaller): ReturnType<AgentRevisionLifecycleRepository["getService"]>
	{
		return this._Run(async function _GetService(repository, authorization)
		{
			const service = await repository.getService(agentServiceId, caller);
			if (service === null)
				return null;
			const resources = [{ kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }] as const;
			const entitled = await _EntitledIds(authorization, caller, ProductAuthorizationActions.Read, resources);
			return entitled.has(service.id) ? service : null;
		});
	}

	/** Loads service eligibility for internal run admission without applying a human read filter. */
	getServiceForAdmission(agentServiceId: string, siloId: string): Promise<AgentService | null>
	{
		return this._Run(function _GetService(repository) { return repository.getServiceForAdmission(agentServiceId, siloId); });
	}

	/** Loads one revision when the current Principal may read it. */
	getRevision(agentRevisionId: string, caller: AgentServiceReadCaller): ReturnType<AgentRevisionLifecycleRepository["getRevision"]>
	{
		return this._Run(async function _GetRevision(repository, authorization)
		{
			const revision = await repository.getRevision(agentRevisionId, caller);
			if (revision === null)
				return null;
			const resources = [{ kind: ProductAuthorizationResourceKinds.AgentRevision, id: revision.id }] as const;
			const entitled = await _EntitledIds(authorization, caller, ProductAuthorizationActions.Read, resources);
			return entitled.has(revision.id) ? revision : null;
		});
	}

	/** Creates one service and first revision after current management admission succeeds. */
	createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		return this._Run(async function _Create(repository, authorization)
		{
			const argumentsValue = { operation: "create", name: command.name };
			if (!await _AdmitManagement(authorization, command.siloId, command.principalId, argumentsValue, command.content.boundaryAttachments, Date.parse(createdAt)))
				return { outcome: "denied", reason: AgentRevisionLifecycleDenials.Unauthorized };
			return repository.createManagedService(command, createdAt);
		});
	}

	/** Appends one draft revision after current management admission succeeds. */
	reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		return this._Run(async function _Revise(repository, authorization)
		{
			const argumentsValue = { operation: "revise", agentServiceId: command.agentServiceId, expectedParentRevisionId: command.expectedParentRevisionId };
			if (!await _AdmitManagement(authorization, command.siloId, command.principalId, argumentsValue, command.content.boundaryAttachments, Date.parse(createdAt)))
				return { outcome: "denied", reason: AgentRevisionLifecycleDenials.Unauthorized };
			return repository.reviseRevision(command, createdAt);
		});
	}

	/** Restores one revision after current management admission succeeds. */
	restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		return this._Run(async function _Restore(repository, authorization)
		{
			const argumentsValue = { operation: "restore", agentServiceId: command.agentServiceId, sourceRevisionId: command.sourceRevisionId };
			if (!await _AdmitManagement(authorization, command.siloId, command.principalId, argumentsValue, [], Date.parse(createdAt)))
				return { outcome: "denied", reason: AgentRevisionLifecycleDenials.Unauthorized };
			return repository.restoreRevision(command, createdAt);
		});
	}

	/** Changes one service state after current management admission succeeds. */
	changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
	{
		return this._Run(async function _Change(repository, authorization)
		{
			const argumentsValue = { operation: command.action, agentServiceId: command.agentServiceId, expectedState: command.expectedState };
			if (!await _AdmitManagement(authorization, command.siloId, command.principalId, argumentsValue, [], Date.parse(changedAt)))
				return { outcome: "denied", reason: AgentRevisionLifecycleDenials.Unauthorized };
			return repository.changeServiceState(command, changedAt);
		});
	}

	/** Reads the service history entries that the current Principal may read. */
	readHistory(agentServiceId: string, caller: AgentServiceReadCaller, runLimit: number): Promise<AgentServiceHistory>
	{
		return this._Run(async function _History(repository, authorization)
		{
			const service = await repository.getService(agentServiceId, caller);
			if (service === null)
				return { revisions: [], runs: [] };
			const serviceResources = [{ kind: ProductAuthorizationResourceKinds.AgentService, id: service.id }] as const;
			const readableService = await _EntitledIds(authorization, caller, ProductAuthorizationActions.Read, serviceResources);
			if (!readableService.has(service.id))
				return { revisions: [], runs: [] };
			const history = await repository.readHistory(agentServiceId, caller, runLimit);
			const [revisionIds, runIds] = await Promise.all([
				_EntitledIds(authorization, caller, ProductAuthorizationActions.Read, history.revisions.map(revision => ({ kind: ProductAuthorizationResourceKinds.AgentRevision, id: revision.id }))),
				_EntitledIds(authorization, caller, ProductAuthorizationActions.Read, history.runs.map(run => ({ kind: ProductAuthorizationResourceKinds.AgentRun, id: run.id }))),
			]);
			return { revisions: history.revisions.filter(revision => revisionIds.has(revision.id)), runs: history.runs.filter(run => runIds.has(run.id)) };
		});
	}

	/** Runs one lifecycle operation with its central authority inside a serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaAgentRevisionLifecycleRepository, authorization: AuthorizationAuthority) => Promise<TResult>): Promise<TResult>
	{
		const createAuthorization = this.createAuthorization;
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const authorization = createAuthorization === null ? new PrismaAuthorizationAuthority(transaction) : createAuthorization(transaction);
			const repository = new PrismaAgentRevisionLifecycleRepository(transaction);
			return operation(repository, authorization);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Admits Organization administration and every requested knowledge-boundary attachment. */
async function _AdmitManagement(authorization: AuthorizationAuthority, siloId: string, principalId: string, argumentsValue: JsonValue, attachments: readonly RevisionBoundaryAttachment[], nowEpochMs: number): Promise<boolean>
{
	const argumentsDigest = ___DigestCanonicalJson(argumentsValue);
	const resource = { kind: ProductAuthorizationResourceKinds.Organization, id: siloId } as const;
	const root = await authorization.admitPrincipal({ siloId, principalId, actorKind: "user", actorId: principalId, resource, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs });
	if (root.outcome !== AuthorizationDecisionOutcomes.Allow)
		return false;
	for (const attachment of attachments)
	{
		const boundary: AuthorizationBoundary = attachment.boundaryKind === RevisionBoundaryKinds.Group ? { kind: AuthorizationBoundaryKinds.Group, groupId: attachment.boundaryId } : { kind: AuthorizationBoundaryKinds.Personal, principalId: attachment.boundaryId };
		const requiredBoundaryCoverage = attachment.boundaryCoverage === RevisionBoundaryCoverages.Descendants ? AuthorizationBoundaryCoverages.Descendants : AuthorizationBoundaryCoverages.Exact;
		const admission = await authorization.admit({ siloId, principalId, actorKind: "user", actorId: principalId, boundary, requiredBoundaryCoverage, resource, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs });
		if (admission.outcome !== AuthorizationDecisionOutcomes.Allow)
			return false;
	}
	return true;
}

/** Returns the resource identifiers that the central authority currently allows. */
async function _EntitledIds(authorization: AuthorizationAuthority, caller: AgentServiceReadCaller, action: ProductAuthorizationActions, resources: readonly ProductAuthorizationResourceLocator[]): Promise<ReadonlySet<string>>
{
	const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action, resources, nowEpochMs: Date.now() });
	return new Set(entitled.map(resource => resource.id));
}
