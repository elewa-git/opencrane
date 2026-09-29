import { AgentRoutineFiringDisposition, type Prisma } from "@prisma/client";

import { ___ParseRoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { RoutineFiringReasons, type RoutineCreationOptionsResponse, type RoutineFiringListItem, type RoutineListItem, type RoutineManagedServiceChoice } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineStatus } from "@opencrane/models/agents";

import type { EncryptedRoutineProjection, ReadRoutineCommand, RoutineCaller } from "./routine-authority.types";
import { RoutineCommandUnavailableError } from "./routine-command.errors";
import type { RoutineFactsRepository, CurrentRoutineRows } from "./routine-prisma-facts.types";
import { _MODEL_FIRING_DISPOSITION, _MODEL_FIRING_TRIGGER, _MODEL_ROUTINE_STATUS } from "./routine-prisma-mapping";
import type { RoutineConversationDirectory, RoutineFiringListPersistencePage, RoutineFiringListPersistenceQuery, RoutineListPersistencePage, RoutineListPersistenceQuery, RoutineManagedServiceDirectory, RoutineReadPersistence, RoutineRunHistoryRepository, RoutineRunHistoryRequest } from "./routine-read.types";

/** Maps every stored refusal or overlap reason to the closed public value. */
const _PUBLIC_REASON = new Map<string, RoutineFiringReasons>([
	["routine_retired", RoutineFiringReasons.RoutineRetired],
	["current_authority_or_audience_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["unfinished_firing", RoutineFiringReasons.UnfinishedFiring],
	["preparation_current_execution_eligibility_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["activation_current_execution_eligibility_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["run_admission_current_authority_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["stage_preparation_current_authority_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["stage_activation_current_authority_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	["stage_run_admission_current_authority_refused", RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
]);

/** Reads authorized routine definitions and occurrence history inside one serializable snapshot. */
export class PrismaRoutineReadRepository implements RoutineReadPersistence
{
	/** Reuses service discovery within this transaction snapshot. */
	private serviceList: Promise<readonly { readonly agentServiceId: string; readonly name: string }[]> | null = null;
	/** Reuses execution eligibility once per selected service within this transaction snapshot. */
	private readonly serviceEligibility = new Map<string, Promise<boolean>>();
	/** Shares current facts, conversation projections, service eligibility, and run facts. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly facts: RoutineFactsRepository, private readonly conversations: RoutineConversationDirectory<Prisma.TransactionClient>, private readonly managedServices: RoutineManagedServiceDirectory, private readonly runHistory: RoutineRunHistoryRepository) {}

	/** Reads one encrypted definition with display labels and command hints from the same snapshot. */
	public async read(command: ReadRoutineCommand): Promise<EncryptedRoutineProjection | null>
	{
		const current = await this.facts.current(command.caller.siloId, command.routineId);
		if (current === null || !current.revision.audiencePrincipalIds.includes(command.caller.principalId))
			return null;
		const now = await this.facts.databaseNow();
		if (!await this._MayRead(command.caller, current, now))
			return null;
		const audienceChoices = await this.conversations.projectAudience(command.caller, current.routine.destinationConversationId, current.revision.audiencePrincipalIds);
		const listItem = await this._ListItem(command.caller, current, now);
		return {
			...listItem,
			selectedManagedServiceId: current.routine.selectedManagedServiceId,
			requesterPrincipalId: current.routine.originalRequesterPrincipalId,
			requesterIssuer: current.routine.requesterIssuer,
			requesterSubjectId: current.routine.requesterSubjectId,
			requesterAuthenticatedAt: current.routine.requesterAuthenticatedAt.toISOString(),
			audienceParticipantRefs: audienceChoices.map(choice => choice.participantRef),
			audienceChoices,
			instruction: { keyId: current.revision.instructionKeyId, nonce: current.revision.instructionNonce, authTag: current.revision.instructionAuthTag, ciphertext: current.revision.instructionCiphertext, ciphertextDigest: current.revision.instructionCiphertextDigest as `sha256:${string}` },
		};
	}

	/** @inheritdoc */
	public async list(query: RoutineListPersistenceQuery): Promise<RoutineListPersistencePage>
	{
		const rows = await this.transaction.agentRoutine.findMany({ where: { siloId: query.caller.siloId, revisions: { some: { audiencePrincipalIds: { has: query.caller.principalId } } }, ..._AfterRoutine(query.after) }, select: { id: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
		const candidates = rows.slice(0, query.limit);
		const now = await this.facts.databaseNow();
		const items: RoutineListItem[] = [];
		for (const candidate of candidates)
		{
			const current = await this.facts.current(query.caller.siloId, candidate.id);
			if (current === null || !current.revision.audiencePrincipalIds.includes(query.caller.principalId) || !await this._MayRead(query.caller, current, now))
				continue;
			items.push(await this._ListItem(query.caller, current, now));
		}
		const last = rows.length > query.limit ? candidates.at(-1) : undefined;
		return { items, next: last === undefined ? null : { createdAt: last.createdAt.toISOString(), id: last.id } };
	}

	/** @inheritdoc */
	public async firings(query: RoutineFiringListPersistenceQuery): Promise<RoutineFiringListPersistencePage>
	{
		const current = await this.facts.current(query.caller.siloId, query.routineId);
		const now = await this.facts.databaseNow();
		if (current === null || !await this._MayRead(query.caller, current, now))
			throw new RoutineCommandUnavailableError("routine history is unavailable");
		const rows = await this.transaction.agentRoutineFiring.findMany({ where: { siloId: query.caller.siloId, routineId: query.routineId, ..._AfterFiring(query.after) }, select: { id: true, siloId: true, routineId: true, routineRevision: true, trigger: true, disposition: true, scheduledSlot: true, conversationId: true, runId: true, preparationReceipt: true, refusalReason: true, resultReference: true, resultDigest: true, createdAt: true, finishedAt: true, revision: { select: { revision: true, routineId: true, siloId: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
		const candidates = rows.slice(0, query.limit);
		for (const row of candidates)
		{
			if (row.revision.revision !== row.routineRevision || row.revision.routineId !== row.routineId || row.revision.siloId !== row.siloId || (row.resultReference === null) !== (row.resultDigest === null))
				throw new Error("routine history found inconsistent firing evidence");
		}
		const requests: RoutineRunHistoryRequest[] = candidates.filter(row => row.runId !== null).map(row => ({ runId: row.runId!, siloId: row.siloId, routineId: row.routineId, routineRevision: row.routineRevision, firingId: row.id, conversationId: row.conversationId, trigger: _MODEL_FIRING_TRIGGER[row.trigger], scheduledSlot: row.scheduledSlot?.toISOString() ?? null }));
		const runFacts = await this.runHistory.read(requests);
		if (runFacts.length !== requests.length)
			throw new Error("routine history run projection is incomplete");
		const factsByRun = new Map(runFacts.map(fact => [fact.runId, fact]));
		const linkCandidates = candidates.filter(row => _MayLinkResult(row, factsByRun.get(row.runId ?? ""))).map(row => row.conversationId);
		const readable = new Set(await this.conversations.readableConversationIds(query.caller, linkCandidates, now));
		const items: RoutineFiringListItem[] = candidates.map(row =>
		{
			const facts = row.runId === null ? undefined : factsByRun.get(row.runId);
			if (row.runId !== null && facts === undefined)
				throw new Error("routine history is missing checked run facts");
			return { firingId: row.id, routineRevision: row.routineRevision, trigger: _MODEL_FIRING_TRIGGER[row.trigger], disposition: _MODEL_FIRING_DISPOSITION[row.disposition], scheduledSlot: row.scheduledSlot?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, reason: _Reason(row.refusalReason), runTerminalReason: facts?.terminalReason ?? null, resultConversationId: _MayLinkResult(row, facts) && readable.has(row.conversationId) ? row.conversationId : null, actualCost: facts?.actualCost ?? null };
		});
		const last = rows.length > query.limit ? candidates.at(-1) : undefined;
		return { items, next: last === undefined ? null : { createdAt: last.createdAt.toISOString(), id: last.id } };
	}

	/** @inheritdoc */
	public async creationOptions(caller: RoutineCaller, destinationConversationId: string): Promise<RoutineCreationOptionsResponse>
	{
		const now = await this.facts.databaseNow();
		const audienceChoices = await this.conversations.creationAudience(caller, destinationConversationId, now);
		if (audienceChoices === null)
			throw new RoutineCommandUnavailableError("routine creation destination is unavailable");
		const services = await this.managedServices.list(caller);
		return { destinationConversationId, audienceChoices, managedServiceChoices: services.map(service => ({ managedServiceId: service.agentServiceId, displayName: service.name })) };
	}

	/** @inheritdoc */
	public previewClock(): Promise<Date>
	{
		return this.facts.databaseNow();
	}

	/** Maps one current definition after the common read gate succeeded. */
	private async _ListItem(caller: RoutineCaller, current: CurrentRoutineRows, now: Date): Promise<RoutineListItem>
	{
		const last = await this.transaction.agentRoutineFiring.findFirst({ where: { routineId: current.routine.id, siloId: current.routine.siloId }, select: { id: true, routineRevision: true, trigger: true, disposition: true, scheduledSlot: true, finishedAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
		const ownership = _Owns(caller, current) ? "owner" : "audience";
		const lastAutomaticOccurrence = current.routine.lastAutomaticOccurrence?.toISOString() ?? null;
		const lastFiring = last === null ? null : {
			firingId: last.id,
			routineRevision: last.routineRevision,
			trigger: _MODEL_FIRING_TRIGGER[last.trigger],
			disposition: _MODEL_FIRING_DISPOSITION[last.disposition],
			scheduledSlot: last.scheduledSlot?.toISOString() ?? null,
			finishedAt: last.finishedAt?.toISOString() ?? null,
		};
		return { ..._Definition(current), ownership, destinationConversationId: current.routine.destinationConversationId, selectedManagedService: await this._Service(caller, current.routine.selectedManagedServiceId), schedule: { expression: current.revision.scheduleExpression, timezone: current.revision.scheduleTimezone }, lastAutomaticOccurrence, lastFiring, capabilities: await this._Capabilities(caller, current, now) };
	}

	/** Derives command hints from current lifecycle and central decisions without admitting effects. */
	private async _Capabilities(caller: RoutineCaller, current: CurrentRoutineRows, now: Date): Promise<RoutineListItem["capabilities"]>
	{
		const status = this.facts.modelStatus(current.routine);
		if (!_Owns(caller, current) || status === RoutineStatus.Retired)
			return _NoCapabilities();
		const edit = await this.facts.principalActionAllowed(caller.principalId, caller.siloId, ProductAuthorizationResourceKinds.Routine, current.routine.id, ProductAuthorizationActions.Edit, now, false, {});
		const retire = await this.facts.principalActionAllowed(caller.principalId, caller.siloId, ProductAuthorizationResourceKinds.Routine, current.routine.id, ProductAuthorizationActions.Retire, now, false, {});
		const use = await this.facts.principalActionAllowed(caller.principalId, caller.siloId, ProductAuthorizationResourceKinds.Routine, current.routine.id, ProductAuthorizationActions.Use, now, false, {});
		const invoke = await this._Eligible(caller, current.routine.selectedManagedServiceId);
		return { revise: edit, pause: edit && status === RoutineStatus.Active, resume: edit && status === RoutineStatus.Paused, retire, runNow: use && invoke };
	}

	/** Applies active/paused all-audience policy or retired per-reader policy. */
	private async _MayRead(caller: RoutineCaller, current: CurrentRoutineRows, now: Date): Promise<boolean>
	{
		try
		{
			if (!current.revision.audiencePrincipalIds.includes(caller.principalId))
				return false;
			if (this.facts.modelStatus(current.routine) === RoutineStatus.Retired)
				await this.facts.requireCurrentReader(caller, current.routine, current.revision, now);
			else
			{
				await this.facts.requireCurrentAudience(current.routine, current.revision, now);
				await this.facts.requirePrincipalAction(caller.principalId, caller.siloId, ProductAuthorizationResourceKinds.Routine, current.routine.id, ProductAuthorizationActions.Read, now, false, {});
			}
			return true;
		}
		catch (error)
		{
			if (error instanceof RoutineCommandUnavailableError)
				return false;
			throw error;
		}
	}

	/** Returns the eligible service name or a non-sensitive unavailable label. */
	private async _Service(caller: RoutineCaller, serviceId: string): Promise<RoutineManagedServiceChoice>
	{
		this.serviceList ??= this.managedServices.list(caller);
		const services = await this.serviceList;
		const service = services.find(candidate => candidate.agentServiceId === serviceId);
		return { managedServiceId: serviceId, displayName: service?.name ?? "Unavailable assistant" };
	}

	/** Reuses one external identity and model eligibility read for each selected service. */
	private _Eligible(caller: RoutineCaller, serviceId: string): Promise<boolean>
	{
		let eligible = this.serviceEligibility.get(serviceId);
		if (eligible === undefined)
		{
			eligible = this.managedServices.eligible(caller, serviceId).then(function _Allowed(candidate) { return candidate !== null; });
			this.serviceEligibility.set(serviceId, eligible);
		}
		return eligible;
	}
}

/** Builds the descending keyset predicate after one examined position. */
function _AfterRoutine(after: { readonly createdAt: string; readonly id: string } | null): Prisma.AgentRoutineWhereInput
{
	return _After(after);
}

/** Builds the descending firing keyset predicate after one examined position. */
function _AfterFiring(after: { readonly createdAt: string; readonly id: string } | null): Prisma.AgentRoutineFiringWhereInput
{
	return _After(after);
}

/** Builds the shared descending keyset predicate after one examined position. */
function _After(after: { readonly createdAt: string; readonly id: string } | null): { OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }] }
{
	if (after === null)
		return {};
	const createdAt = new Date(after.createdAt);
	if (!Number.isFinite(createdAt.getTime()))
		throw new Error("routine page position contains an invalid instant");
	return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: after.id } }] };
}

/** Maps common definition coordinates without exposing requester identity. */
function _Definition(current: CurrentRoutineRows)
{
	return { routineId: current.routine.id, currentRevision: current.routine.currentRevision, status: _MODEL_ROUTINE_STATUS[current.routine.status], lifecycleRevision: current.routine.lifecycleRevision, nextAutomaticOccurrence: current.routine.nextAutomaticOccurrence?.toISOString() ?? null };
}

/** Checks immutable requester coordinates without comparing a newer session authentication instant. */
function _Owns(caller: RoutineCaller, current: CurrentRoutineRows): boolean
{
	return current.routine.siloId === caller.siloId && current.routine.originalRequesterPrincipalId === caller.principalId && current.routine.requesterIssuer === caller.issuer && current.routine.requesterSubjectId === caller.subjectId;
}

/** Returns the closed empty command-hint set for audience readers and retired routines. */
function _NoCapabilities(): RoutineListItem["capabilities"]
{
	return { revise: false, pause: false, resume: false, retire: false, runNow: false };
}

/** Maps one stored reason and rejects an unknown non-null value as corrupted history. */
function _Reason(value: string | null): RoutineFiringReasons | null
{
	if (value === null)
		return null;
	const reason = _PUBLIC_REASON.get(value);
	if (reason === undefined)
		throw new Error("routine history contains an unknown firing reason");
	return reason;
}

/** Requires completed SQL and run evidence plus a reference to the expected conversation stream. */
function _MayLinkResult(row: { readonly disposition: AgentRoutineFiringDisposition; readonly conversationId: string; readonly preparationReceipt: Prisma.JsonValue | null; readonly resultReference: string | null; readonly resultDigest: string | null }, facts: { readonly terminalReason: string | null } | undefined): boolean
{
	if (row.disposition !== AgentRoutineFiringDisposition.Completed || row.resultReference === null || row.resultDigest === null || facts?.terminalReason !== AgentRunTerminalReasons.Success)
		return false;
	const preparation = ___ParseRoutineOccurrencePreparationReceipt(row.preparationReceipt);
	if (preparation.historyReference !== `routine-occurrence-instruction-${row.conversationId}`)
		throw new Error("routine history found an inconsistent preparation reference");
	const prefix = `conversation-${row.conversationId}#`;
	return row.resultReference.startsWith(prefix) && row.resultReference.length > prefix.length;
}
