import { AgentRevisionState, AgentServiceKind, AgentServiceState, PersonaRevisionState, type Prisma } from "@prisma/client";

import { INITIAL_PERSONAL_AGENT_POLICY } from "../initial-personal-agent-policy";
import type { InitialPersonalAgentDefaultModelResolver } from "../initial-personal-agent-publication.types";
import { AgentRevisionPersonaSelectionMaterializationCodes } from "../agent-revision-persona-selection.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type DeniedPersonalAgentBootstrapResult, type PersonalAgentBootstrapCommand, type PersonalAgentBootstrapRepository, type PersonalAgentBootstrapResult, type ReadyPersonalAgentBootstrapResult } from "../personal-agent-bootstrap.types";
import type { PersonalAgentProductCaller, PersonalAgentProductEffects } from "../personal-agent-product-effects.types";
import { PrismaPersonalAgentProductEffectsAuthority } from "../prisma-personal-agent-product-effects";
import { PrismaAgentRevisionPersonaSelectionRepository } from "./prisma-agent-revision-persona-selection";
import { PrismaInitialPersonalAgentPublicationRepository } from "./prisma-initial-personal-agent-publication";

/** Immutable evidence returned after validating the approved active persona. */
interface _ApprovedPersona
{
	/** Stable profile protected by the central Persona resource. */
	readonly profileId: string;
	/** Current approved persona revision used only when a personal service must be created. */
	readonly id: string;
	/** Display name inherited by the stable personal AgentService. */
	readonly displayName: string;
	/** Approved revision lineage that proves an existing personal service belongs to this owner. */
	readonly approvedRevisionIds: readonly string[];
}

/** One active personal service and the published revision it currently points at. */
interface _ReadyPersonalService
{
	/** Stable service identity. */
	readonly id: string;
	/** Published active revision identity. */
	readonly activeRevisionId: string;
	/** Controller runtime profile stored on the service. */
	readonly workloadProfile: string;
	/** Persona revision frozen into the active executable revision. */
	readonly personaRevisionId: string;
	/** Model definition frozen into the active executable revision. */
	readonly modelDefinitionId: string;
}

/** Returns a stable denied result without writing authority state. */
function _Denied(reason: PersonalAgentBootstrapDenialReasons): DeniedPersonalAgentBootstrapResult
{
	return { status: PersonalAgentBootstrapStatuses.Denied, reason };
}

/** Returns readiness evidence for an existing or newly created personal service. */
function _Ready(service: _ReadyPersonalService, created: boolean, revised: boolean): ReadyPersonalAgentBootstrapResult
{
	return {
		status: PersonalAgentBootstrapStatuses.Ready,
		agentServiceId: service.id,
		agentRevisionId: service.activeRevisionId,
		created,
		revised,
	};
}

/** Returns whether a required identifier carries a non-empty value. */
function _Present(value: string): boolean
{
	return value.trim().length > 0;
}

/** Validates bootstrap input before any authority repository is consulted. */
function _ValidCommand(command: PersonalAgentBootstrapCommand): boolean
{
	return _Present(command.onboardingId)
		&& _Present(command.siloId)
		&& _Present(command.subjectId)
		&& _Present(command.onboardingPersonaRevisionId)
		&& (command.readinessKind === "completion" || command.readinessKind === "repair")
		&& Number.isFinite(command.provisionedAt.getTime());
}

/**
 * Resolves or creates an onboarding subject's first personal AgentService.
 *
 * The surrounding onboarding unit of work owns the Serializable transaction and constructs this
 * repository with its transaction client. This repository never commits. It validates the approved
 * active persona, consumes model-routing's configured default result, and owns deterministic service
 * identity, immutable revision mapping, publication, activation, and the audit row.
 */
export class PrismaPersonalAgentBootstrapRepository implements PersonalAgentBootstrapRepository
{
	/** Transaction-scoped ORM client supplied by the onboarding completion unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** App-provided adapter to model-routing's transaction-scoped default resolver. */
	private readonly defaultModelResolver: InitialPersonalAgentDefaultModelResolver;
	/** Shared product-effect adapter bound to the onboarding transaction. */
	private readonly productEffects: PersonalAgentProductEffects;

	/** Creates the personal-agent strategy inside an existing Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, defaultModelResolver: InitialPersonalAgentDefaultModelResolver, productEffects: PersonalAgentProductEffects | null = null)
	{
		this.transaction = transaction;
		this.defaultModelResolver = defaultModelResolver;
		this.productEffects = productEffects ?? new PrismaPersonalAgentProductEffectsAuthority(transaction);
	}

	/**
	 * Validates onboarding authority and leaves one published personal Agent ready in the open transaction.
	 *
	 * Called by: the agent-services adapter in `apps/opencrane/src/app/user-onboarding-composition.ts`.
	 * The surrounding onboarding unit of work owns commit and rollback, so completion cannot commit
	 * unless this method returns readiness and the onboarding compare-and-swap also succeeds.
	 *
	 * @returns `Ready` with the active service and revision, including whether this attempt created
	 * or revised them; returns `Denied` when persona, service, or default-model evidence fails closed.
	 * @throws When Prisma, revision publication, active-pointer comparison, or audit persistence
	 * fails; the onboarding unit of work rolls back the attempt.
	 */
	async ensureReady(command: PersonalAgentBootstrapCommand): Promise<PersonalAgentBootstrapResult>
	{
		if (!_ValidCommand(command))
			return _Denied(PersonalAgentBootstrapDenialReasons.InvalidCommand);

		// 1. Re-read the approved persona so onboarding cannot provision from foreign or stale evidence.
		const persona = await this._ReadApprovedPersona(command);
		if ("status" in persona)
			return persona;
		if (command.readinessKind === "completion" && persona.id !== command.onboardingPersonaRevisionId)
			return _Denied(PersonalAgentBootstrapDenialReasons.PersonaNotActive);
		const caller = await this.productEffects.resolveCaller(command.siloId, command.subjectId);
		if (caller === null)
			return _Denied(PersonalAgentBootstrapDenialReasons.PrincipalUnavailable);

		// 2. Resolve every matching runnable service before creating anything, because ambiguity must
		// fail closed and an earlier successful retry must return its existing winner.
		const matching = await this._ReadMatchingServices(command, persona);
		if (matching.length > 1)
			return _Denied(PersonalAgentBootstrapDenialReasons.ServiceAmbiguous);

		// 3. Inspect the deterministic identity independently so an unrelated row can never be adopted.
		const deterministic = await this.transaction.agentService.findUnique({
			where: { id: command.onboardingId },
			select: { id: true, siloId: true, kind: true, state: true, activeRevisionId: true, workloadProfile: true, activeRevision: { select: { personaRevisionId: true, modelDefinitionId: true } } },
		});
		if (deterministic !== null)
		{
			if (deterministic.siloId !== command.siloId || deterministic.kind !== AgentServiceKind.Personal)
			{
				return _Denied(PersonalAgentBootstrapDenialReasons.ServiceIdentityConflict);
			}
			if (matching.length !== 1 || matching[0]?.id !== deterministic.id || deterministic.state !== AgentServiceState.Active || deterministic.activeRevisionId === null || deterministic.activeRevision?.personaRevisionId === null || deterministic.workloadProfile !== INITIAL_PERSONAL_AGENT_POLICY.workloadProfile)
			{
				return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			}
			const activeRevision = deterministic.activeRevision;
			if (activeRevision === null || activeRevision.personaRevisionId === null)
				return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			return this._EnsureCurrentPersona(command, persona, { id: deterministic.id, activeRevisionId: deterministic.activeRevisionId, workloadProfile: deterministic.workloadProfile, personaRevisionId: activeRevision.personaRevisionId, modelDefinitionId: activeRevision.modelDefinitionId }, caller);
		}
		if (matching.length === 1)
		{
			const existing = matching[0];
			if (existing === undefined)
				return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			if (existing.workloadProfile !== INITIAL_PERSONAL_AGENT_POLICY.workloadProfile)
				return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			return this._EnsureCurrentPersona(command, persona, existing, caller);
		}

		// 4. Delegate initial publication after bootstrap has proved that no service exists.
		const publicationRepository = new PrismaInitialPersonalAgentPublicationRepository(this.transaction, this.defaultModelResolver, this.productEffects);
		return publicationRepository.publish(command, persona, caller);
	}

	/** Reconcile one existing service to the owner's current approved persona without replacing it. */
	private async _EnsureCurrentPersona(command: PersonalAgentBootstrapCommand, persona: _ApprovedPersona, service: _ReadyPersonalService, caller: PersonalAgentProductCaller): Promise<PersonalAgentBootstrapResult>
	{
		if (service.personaRevisionId === persona.id)
		{
			await this.productEffects.reconcileCurrent(caller, { agentServiceId: service.id, agentRevisionId: service.activeRevisionId, personaProfileId: persona.profileId, modelDefinitionId: service.modelDefinitionId }, command.provisionedAt);
			return _Ready(service, false, false);
		}
		const cmd = {
			siloId: command.siloId,
			subjectId: command.subjectId,
			principalId: caller.principalId,
			agentServiceId: service.id,
			expectedSourceRevisionId: service.activeRevisionId,
			targetPersonaRevisionId: persona.id,
			authoredBy: command.subjectId,
			materializedAt: command.provisionedAt,
			changeMessage: "Selected the current approved persona during onboarding readiness repair.",
		};
		const task = new PrismaAgentRevisionPersonaSelectionRepository(this.transaction, this.productEffects);
		const materialized = await task.materialize(cmd);
		if (materialized.status !== AgentRevisionPersonaSelectionMaterializationCodes.Materialized && materialized.status !== AgentRevisionPersonaSelectionMaterializationCodes.AlreadyCurrent)
		{
			return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
		}
		return _Ready({ ...service, activeRevisionId: materialized.agentRevisionId, personaRevisionId: persona.id }, false, materialized.status === AgentRevisionPersonaSelectionMaterializationCodes.Materialized);
	}

	/** Validates frozen onboarding evidence and resolves the owner's current approved persona. */
	private async _ReadApprovedPersona(command: PersonalAgentBootstrapCommand): Promise<_ApprovedPersona | DeniedPersonalAgentBootstrapResult>
	{
		const revision = await this.transaction.personaRevision.findUnique({
			where: { id: command.onboardingPersonaRevisionId },
			select: {
				state: true,
				approvedAt: true,
				profile: {
					select: {
						id: true,
						siloId: true,
						userId: true,
						activeRevision: { select: { id: true, state: true, approvedAt: true, soulTemplate: { select: { displayName: true } } } },
						revisions: { where: { state: PersonaRevisionState.Approved }, select: { id: true } },
					},
				},
			},
		});
		if (revision === null || revision.state !== PersonaRevisionState.Approved || revision.approvedAt === null || revision.profile.siloId !== command.siloId || revision.profile.userId !== command.subjectId)
		{
			return _Denied(PersonalAgentBootstrapDenialReasons.PersonaUnavailable);
		}
		const active = revision.profile.activeRevision;
		if (active === null || active.state !== PersonaRevisionState.Approved || active.approvedAt === null || !_Present(active.soulTemplate.displayName))
		{
			return _Denied(PersonalAgentBootstrapDenialReasons.PersonaNotActive);
		}
		return { profileId: revision.profile.id, id: active.id, displayName: active.soulTemplate.displayName, approvedRevisionIds: revision.profile.revisions.map(function _RevisionId(candidate) { return candidate.id; }) };
	}

	/** Reads at most two runnable services owned through any approved persona revision of this subject. */
	private async _ReadMatchingServices(command: PersonalAgentBootstrapCommand, persona: _ApprovedPersona): Promise<readonly _ReadyPersonalService[]>
	{
		return this.transaction.agentService.findMany({
			where: {
				siloId: command.siloId,
				kind: AgentServiceKind.Personal,
				state: AgentServiceState.Active,
				activeRevisionId: { not: null },
				activeRevision: { is: { state: AgentRevisionState.Published, personaRevisionId: { in: [...persona.approvedRevisionIds] } } },
			},
			select: { id: true, activeRevisionId: true, workloadProfile: true, activeRevision: { select: { personaRevisionId: true, modelDefinitionId: true } } },
			orderBy: { id: "asc" },
			take: 2,
		}).then(function _Flatten(services)
		{
			return services.flatMap(function _ReadyService(service)
			{
				const activeRevision = service.activeRevision;
				return service.activeRevisionId === null || activeRevision === null || activeRevision.personaRevisionId === null
					? []
					: [{ id: service.id, activeRevisionId: service.activeRevisionId, workloadProfile: service.workloadProfile, personaRevisionId: activeRevision.personaRevisionId, modelDefinitionId: activeRevision.modelDefinitionId }];
			});
		});
	}

}
