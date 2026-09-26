import { AgentRevisionState, AgentServiceKind, AgentServiceState, ConversationLifecycle, PrincipalProvenance } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { RoutineFiringDisposition, type RoutineStatus, type RoutineUnfinishedFiringDisposition } from "@opencrane/models/agents";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { RoutineCaller } from "./routine-authority.types";
import { __IsRoutineFiringUnfinished } from "./routine-firing-lifecycle";
import { _MODEL_FIRING_DISPOSITION, _MODEL_ROUTINE_STATUS, _PRISMA_FIRING_DISPOSITION } from "./routine-prisma-mapping";
import type { CurrentManagedAgent, CurrentRoutineRows, RoutineFactsRepository, RoutineFiringActor, RoutineRevisionRow, RoutineRow } from "./routine-prisma-facts.types";
import { _ROUTINE_REVISION_SELECT, _ROUTINE_SELECT } from "./routine-prisma-selects";

/** Transaction-owned fact loader shared by routine persistence adapters. */
export class PrismaRoutineFactsRepository implements RoutineFactsRepository
{
	/** Prisma transaction that owns every fact read. */
	private readonly transaction: Prisma.TransactionClient;
	/** Central authorization authority built over the same transaction. */
	private readonly authorization: AuthorizationAuthority;

	/** Binds fact reads and central decisions to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient, authorization: AuthorizationAuthority)
	{
		this.transaction = transaction;
		this.authorization = authorization;
	}

	/** Reads the shared AgentRun database clock and fails closed when it is unavailable. */
	async databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.agentRunAuthorityClock.findUnique({ where: { singleton: 1 }, select: { now: true } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
		{
			throw new Error("routine database clock is unavailable");
		}
		return clock.now;
	}

	/** Loads the routine and the exact immutable revision named by its current pointer. */
	async current(siloId: string, routineId: string): Promise<CurrentRoutineRows | null>
	{
		const routine = await this.transaction.agentRoutine.findFirst({ where: { id: routineId, siloId }, select: _ROUTINE_SELECT });
		if (routine === null)
		{
			return null;
		}
		const revision = await this.transaction.agentRoutineRevision.findUnique({ where: { routineId_revision: { routineId, revision: routine.currentRevision } }, select: _ROUTINE_REVISION_SELECT });
		if (revision === null || revision.siloId !== siloId)
		{
			throw new Error("routine current revision is unavailable");
		}
		return { routine, revision };
	}

	/** Requires the authenticated caller to be the immutable original requester. */
	requireOriginalRequester(caller: RoutineCaller, routine: RoutineRow): void
	{
		if (routine.siloId !== caller.siloId || routine.originalRequesterPrincipalId !== caller.principalId || routine.requesterIssuer !== caller.issuer || routine.requesterSubjectId !== caller.subjectId)
		{
			throw new Error("routine command requires the original requester");
		}
	}

	/** Verifies the exact reviewed audience against current external participants and Read grants. */
	async resolveCreationAudience(caller: RoutineCaller, destinationConversationId: string, selectedPrincipalIds: readonly string[], now: Date): Promise<readonly string[]>
	{
		const conversation = await this.transaction.conversation.findFirst({
			where: { id: destinationConversationId, siloId: caller.siloId, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } },
			select: { participants: { where: { accessEndedPosition: null }, select: { userId: true }, orderBy: { userId: "asc" } } },
		});
		if (conversation === null)
		{
			throw new Error("routine destination conversation is not currently available to the requester");
		}
		await this.requirePrincipalAction(caller.principalId, caller.siloId, ProductAuthorizationResourceKinds.Conversation, destinationConversationId, ProductAuthorizationActions.Read, now, false, {});
		const currentSubjects = new Set(conversation.participants.map(participant => participant.userId));
		const principals = await this.transaction.principal.findMany({ where: { siloId: caller.siloId, id: { in: [...selectedPrincipalIds] }, provenance: PrincipalProvenance.External }, select: { id: true, subject: true } });
		if (principals.length !== selectedPrincipalIds.length)
		{
			throw new Error("routine selected audience Principal is unavailable or not external");
		}
		for (const principalId of selectedPrincipalIds)
		{
			const principal = principals.find(candidate => candidate.id === principalId);
			if (principal === undefined || !currentSubjects.has(principal.subject))
			{
				throw new Error("routine selected audience Principal is not a current destination participant");
			}
			await this.requirePrincipalAction(principal.id, caller.siloId, ProductAuthorizationResourceKinds.Conversation, destinationConversationId, ProductAuthorizationActions.Read, now, false, {});
		}
		return [...selectedPrincipalIds];
	}

	/** Rechecks that every fixed audience member still has destination and routine read access. */
	async requireCurrentAudience(routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<void>
	{
		if (!(await this.currentAudienceAllowed(routine, revision, now)))
		{
			throw new Error("routine fixed audience no longer has current destination access");
		}
	}

	/** Rechecks only the retired-history caller against the frozen audience and current destination. */
	async requireCurrentReader(caller: RoutineCaller, routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<void>
	{
		if (caller.siloId !== routine.siloId || !revision.audiencePrincipalIds.includes(caller.principalId))
		{
			throw new Error("routine reader no longer has current destination access");
		}
		const principal = await this.transaction.principal.findFirst({ where: { id: caller.principalId, siloId: caller.siloId, issuer: caller.issuer, subject: caller.subjectId, provenance: PrincipalProvenance.External }, select: { id: true } });
		const conversation = await this.transaction.conversation.findFirst({ where: { id: routine.destinationConversationId, siloId: routine.siloId, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: caller.subjectId, accessEndedPosition: null } } }, select: { id: true } });
		if (principal === null || conversation === null)
		{
			throw new Error("routine reader no longer has current destination access");
		}
		const routineAllowed = await this.principalActionAllowed(caller.principalId, routine.siloId, ProductAuthorizationResourceKinds.Routine, routine.id, ProductAuthorizationActions.Read, now, false, {});
		const conversationAllowed = await this.principalActionAllowed(caller.principalId, routine.siloId, ProductAuthorizationResourceKinds.Conversation, routine.destinationConversationId, ProductAuthorizationActions.Read, now, false, {});
		if (!routineAllowed || !conversationAllowed)
		{
			throw new Error("routine reader no longer has current destination access");
		}
	}

	/** Returns whether every fixed audience member retains destination and routine read access. */
	async currentAudienceAllowed(routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<boolean>
	{
		const principals = await this.transaction.principal.findMany({ where: { siloId: routine.siloId, id: { in: revision.audiencePrincipalIds } }, select: { id: true, subject: true } });
		const subjectByPrincipal = new Map(principals.map(principal => [principal.id, principal.subject]));
		const conversation = await this.transaction.conversation.findFirst({ where: { id: routine.destinationConversationId, siloId: routine.siloId, lifecycle: ConversationLifecycle.Open }, select: { participants: { where: { accessEndedPosition: null }, select: { userId: true } } } });
		const currentSubjects = new Set(conversation?.participants.map(participant => participant.userId) ?? []);
		for (const principalId of revision.audiencePrincipalIds)
		{
			const subject = subjectByPrincipal.get(principalId);
			if (subject === undefined || !currentSubjects.has(subject))
			{
				return false;
			}
			const routineAllowed = await this.principalActionAllowed(principalId, routine.siloId, ProductAuthorizationResourceKinds.Routine, routine.id, ProductAuthorizationActions.Read, now, false, {});
			const conversationAllowed = await this.principalActionAllowed(principalId, routine.siloId, ProductAuthorizationResourceKinds.Conversation, routine.destinationConversationId, ProductAuthorizationActions.Read, now, false, {});
			if (!routineAllowed || !conversationAllowed)
			{
				return false;
			}
		}
		return true;
	}


	/** Loads the current published revision and internal Principal for the selected managed agent. */
	async currentManagedAgent(routine: RoutineRow): Promise<CurrentManagedAgent>
	{
		return await this.currentManagedAgentById(routine.siloId, routine.selectedManagedServiceId);
	}

	/** Returns current managed-agent coordinates, or null when lifecycle facts refuse execution. */
	async findCurrentManagedAgent(routine: RoutineRow): Promise<CurrentManagedAgent | null>
	{
		return await this.findCurrentManagedAgentById(routine.siloId, routine.selectedManagedServiceId);
	}

	/** Loads current managed-agent coordinates from explicit trusted identifiers. */
	async currentManagedAgentById(siloId: string, serviceId: string): Promise<CurrentManagedAgent>
	{
		const current = await this.findCurrentManagedAgentById(siloId, serviceId);
		if (current === null)
		{
			throw new Error("routine selected managed agent is not currently executable");
		}
		return current;
	}

	/** Returns a current managed agent from explicit trusted identifiers. */
	async findCurrentManagedAgentById(siloId: string, serviceId: string): Promise<CurrentManagedAgent | null>
	{
		const service = await this.transaction.agentService.findFirst({
			where: { id: serviceId, siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, activeRevisionId: { not: null }, principal: { is: { siloId } } },
			select: { id: true, principalId: true, activeRevisionId: true, activeRevision: { select: { id: true, state: true, publishedAt: true } } },
		});
		if (service === null || service.principalId === null || service.activeRevisionId === null || service.activeRevision === null || service.activeRevision.id !== service.activeRevisionId || service.activeRevision.state !== AgentRevisionState.Published || service.activeRevision.publishedAt === null)
		{
			return null;
		}
		return { serviceId: service.id, revisionId: service.activeRevisionId, principalId: service.principalId };
	}

	/** Requires one current central decision and optionally records its protected operation evidence. */
	async requirePrincipalAction(principalId: string, siloId: string, resourceKind: ProductAuthorizationResourceKinds, resourceId: string, action: ProductAuthorizationActions, now: Date, admit: boolean, argumentsValue: JsonValue): Promise<void>
	{
		const allowed = await this.principalActionAllowed(principalId, siloId, resourceKind, resourceId, action, now, admit, argumentsValue);
		if (!allowed)
		{
			throw new Error("routine action is not currently authorized");
		}
	}

	/** Checks one central decision and optionally records its protected operation evidence. */
	async principalActionAllowed(principalId: string, siloId: string, resourceKind: ProductAuthorizationResourceKinds, resourceId: string, action: ProductAuthorizationActions, now: Date, admit: boolean, argumentsValue: JsonValue): Promise<boolean>
	{
		const command = { siloId, principalId, resource: { kind: resourceKind, id: resourceId }, action, nowEpochMs: now.getTime() } as const;
		if (!admit)
		{
			const decision = await this.authorization.decidePrincipal(command);
			return decision.outcome === AuthorizationDecisionOutcomes.Allow;
		}
		const result = await this.authorization.admitPrincipal({ ...command, actorKind: "user", actorId: principalId, argumentsDigest: ___DigestCanonicalJson(argumentsValue) });
		return result.outcome === AuthorizationDecisionOutcomes.Allow && result.evidence !== null;
	}

	/** Records Routine Use and managed AgentService Invoke only when both remain allowed. */
	async admitFiringActions(routine: RoutineRow, actor: RoutineFiringActor, now: Date, argumentsValue: JsonValue): Promise<boolean>
	{
		const argumentsDigest = ___DigestCanonicalJson(argumentsValue);
		const common = { siloId: routine.siloId, principalId: routine.originalRequesterPrincipalId, actorKind: actor.actorKind, actorId: actor.actorId, argumentsDigest, nowEpochMs: now.getTime() };
		const results = await this.authorization.admitPrincipalBatch([
			{ ...common, resource: { kind: ProductAuthorizationResourceKinds.Routine, id: routine.id }, action: ProductAuthorizationActions.Use },
			{ ...common, resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: routine.selectedManagedServiceId }, action: ProductAuthorizationActions.Invoke },
		]);
		return results.length === 2 && results.every(result => result.outcome === AuthorizationDecisionOutcomes.Allow && result.evidence !== null);
	}

	/** Returns the unfinished firing that blocks automatic overlap, or null when none exists. */
	async unfinishedFiring(routineId: string): Promise<{ readonly id: string; readonly disposition: RoutineUnfinishedFiringDisposition } | null>
	{
		const dispositions = Object.values(RoutineFiringDisposition).filter(__IsRoutineFiringUnfinished);
		const persisted = dispositions.map(disposition => _PRISMA_FIRING_DISPOSITION[disposition]);
		const row = await this.transaction.agentRoutineFiring.findFirst({ where: { routineId, disposition: { in: persisted } }, select: { id: true, disposition: true }, orderBy: { createdAt: "asc" } });
		if (row === null)
		{
			return null;
		}
		const disposition = _MODEL_FIRING_DISPOSITION[row.disposition];
		if (!__IsRoutineFiringUnfinished(disposition))
		{
			throw new Error("routine unfinished firing query returned a terminal disposition");
		}
		return { id: row.id, disposition };
	}

	/** Maps a stored routine status to the dependency-neutral model. */
	modelStatus(routine: RoutineRow): RoutineStatus
	{
		return _MODEL_ROUTINE_STATUS[routine.status];
	}
}
