import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, PersonaRevisionState, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";
import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";

import { INITIAL_PERSONAL_AGENT_POLICY } from "./initial-personal-agent-policy";
import { AgentRevisionPersonaSelectionMaterializationCodes } from "./agent-revision-persona-selection.types";
import { PersonalAgentBootstrapDenialReasons, PersonalAgentBootstrapStatuses, type DeniedPersonalAgentBootstrapResult, type PersonalAgentBootstrapCommand, type PersonalAgentBootstrapRepository, type PersonalAgentBootstrapResult, type ReadyPersonalAgentBootstrapResult } from "./personal-agent-bootstrap.types";
import { PrismaAgentRevisionPersonaSelectionRepository } from "./prisma-agent-revision-persona-selection";
import { PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/** Capability catalogue recorded for the onboarding-owned initial publication. */
const _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID = "opencrane-personal-agent-bootstrap";

/** Immutable evidence returned after validating the approved active persona. */
interface _ApprovedPersona
{
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
 * repository with its transaction client. This repository never commits. It owns all agent-service
 * persistence decisions: approved active persona validation, default-model precedence, deterministic
 * service identity, immutable revision mapping, publication, activation, and the audit row.
 */
export class PrismaPersonalAgentBootstrapRepository implements PersonalAgentBootstrapRepository
{
	/** Transaction-scoped ORM client supplied by the onboarding completion unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the personal-agent strategy inside an existing Serializable transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Validates authority and leaves exactly one published personal agent ready in this transaction. */
	async ensureReady(command: PersonalAgentBootstrapCommand): Promise<PersonalAgentBootstrapResult>
	{
		if (!_ValidCommand(command)) return _Denied(PersonalAgentBootstrapDenialReasons.InvalidCommand);

		// 1. Re-read the approved persona so onboarding cannot provision from foreign or stale evidence.
		const persona = await this._ReadApprovedPersona(command);
		if ("status" in persona) return persona;
		if (command.readinessKind === "completion" && persona.id !== command.onboardingPersonaRevisionId) return _Denied(PersonalAgentBootstrapDenialReasons.PersonaNotActive);

		// 2. Resolve every matching runnable service before creating anything, because ambiguity must
		// fail closed and an earlier successful retry must return its existing winner.
		const matching = await this._ReadMatchingServices(command, persona);
		if (matching.length > 1) return _Denied(PersonalAgentBootstrapDenialReasons.ServiceAmbiguous);

		// 3. Inspect the deterministic identity independently so an unrelated row can never be adopted.
		const deterministic = await this.transaction.agentService.findUnique({
			where: { id: command.onboardingId },
			select: { id: true, siloId: true, kind: true, state: true, activeRevisionId: true, workloadProfile: true, activeRevision: { select: { personaRevisionId: true } } },
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
			if (activeRevision === null || activeRevision.personaRevisionId === null) return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			return this._EnsureCurrentPersona(command, persona, { id: deterministic.id, activeRevisionId: deterministic.activeRevisionId, workloadProfile: deterministic.workloadProfile, personaRevisionId: activeRevision.personaRevisionId });
		}
		if (matching.length === 1)
		{
			const existing = matching[0];
			if (existing === undefined) return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			if (existing.workloadProfile !== INITIAL_PERSONAL_AGENT_POLICY.workloadProfile) return _Denied(PersonalAgentBootstrapDenialReasons.ServiceNotReady);
			return this._EnsureCurrentPersona(command, persona, existing);
		}

		// 4. Resolve one default model with the silo default taking precedence over the global fallback.
		const model = await this._ResolveDefaultModel(command.siloId);
		if (model.status === PersonalAgentBootstrapStatuses.Denied) return model;

		// 5. Create the stable service and first draft through the shared immutable revision writer.
		const service = await this.transaction.agentService.create({
			data: {
				id: command.onboardingId,
				siloId: command.siloId,
				kind: AgentServiceKind.Personal,
				name: persona.displayName,
				state: AgentServiceState.Draft,
				workloadProfile: INITIAL_PERSONAL_AGENT_POLICY.workloadProfile,
				createdAt: command.provisionedAt,
				updatedAt: command.provisionedAt,
			},
		});
		const content: AgentRevisionContent = {
			promptPolicyVersion: INITIAL_PERSONAL_AGENT_POLICY.promptPolicyVersion,
			personaRevisionId: persona.id,
			modelDefinitionId: model.modelDefinitionId,
			budget: INITIAL_PERSONAL_AGENT_POLICY.budget,
			skills: [],
			integrationAssignments: [],
			scopeAttachments: [],
		};
		const revision = await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({
			siloId: command.siloId,
			agentServiceId: service.id,
			revision: 1,
			parentRevisionId: null,
			sourceRevisionId: null,
			content,
			changeMessage: "Created by completed personal onboarding.",
			authoredBy: command.subjectId,
			createdAt: command.provisionedAt,
		});

		// 6. Publish the revision and activate the service before audit evidence is appended in the
		// same transaction. Any later failure rolls all three writes back together.
		await this.transaction.agentRevision.update({
			where: { id: revision.id },
			data: { state: AgentRevisionState.Published, publishedAt: command.provisionedAt },
		});
		await this.transaction.agentService.update({
			where: { id: service.id },
			data: { state: AgentServiceState.Active, activeRevisionId: revision.id, updatedAt: command.provisionedAt },
		});

		// 7. Record why onboarding was allowed to publish this agent before the owner commits readiness.
		await __AppendAuditDecision(this.transaction, this._BuildAuditDecision(command, persona.id, revision.id, revision.digest));
		return _Ready({ id: service.id, activeRevisionId: revision.id, workloadProfile: service.workloadProfile, personaRevisionId: persona.id }, true, false);
	}

	/** Reconcile one existing service to the owner's current approved persona without replacing it. */
	private async _EnsureCurrentPersona(command: PersonalAgentBootstrapCommand, persona: _ApprovedPersona, service: _ReadyPersonalService): Promise<PersonalAgentBootstrapResult>
	{
		if (service.personaRevisionId === persona.id) return _Ready(service, false, false);
		const materialized = await new PrismaAgentRevisionPersonaSelectionRepository(this.transaction).materialize({
			siloId: command.siloId,
			subjectId: command.subjectId,
			agentServiceId: service.id,
			expectedSourceRevisionId: service.activeRevisionId,
			targetPersonaRevisionId: persona.id,
			authoredBy: command.subjectId,
			materializedAt: command.provisionedAt,
			changeMessage: "Selected the current approved persona during onboarding readiness repair.",
		});
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
		return { id: active.id, displayName: active.soulTemplate.displayName, approvedRevisionIds: revision.profile.revisions.map(function _RevisionId(candidate) { return candidate.id; }) };
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
			select: { id: true, activeRevisionId: true, workloadProfile: true, activeRevision: { select: { personaRevisionId: true } } },
			orderBy: { id: "asc" },
			take: 2,
		}).then(function _Flatten(services)
		{
			return services.flatMap(function _ReadyService(service)
			{
				const activeRevision = service.activeRevision;
				return service.activeRevisionId === null || activeRevision === null || activeRevision.personaRevisionId === null
					? []
					: [{ id: service.id, activeRevisionId: service.activeRevisionId, workloadProfile: service.workloadProfile, personaRevisionId: activeRevision.personaRevisionId }];
			});
		});
	}

	/** Resolves the unique silo default, or the unique global default when the silo has none. */
	private async _ResolveDefaultModel(siloId: string): Promise<{ readonly status: PersonalAgentBootstrapStatuses.Ready; readonly modelDefinitionId: string } | DeniedPersonalAgentBootstrapResult>
	{
		const tenant = await this.transaction.modelDefinition.findMany({
			where: { scope: ModelRoutingScope.ClusterTenant, clusterTenant: siloId, isDefault: true },
			select: { id: true },
			orderBy: { id: "asc" },
			take: 2,
		});
		if (tenant.length > 1) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);
		if (tenant.length === 1)
		{
			const selected = tenant[0];
			if (selected === undefined) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
			return { status: PersonalAgentBootstrapStatuses.Ready, modelDefinitionId: selected.id };
		}
		const global = await this.transaction.modelDefinition.findMany({
			where: { scope: ModelRoutingScope.Global, clusterTenant: null, isDefault: true },
			select: { id: true },
			orderBy: { id: "asc" },
			take: 2,
		});
		if (global.length > 1) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelAmbiguous);
		if (global.length === 0) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		const selected = global[0];
		if (selected === undefined) return _Denied(PersonalAgentBootstrapDenialReasons.DefaultModelUnavailable);
		return { status: PersonalAgentBootstrapStatuses.Ready, modelDefinitionId: selected.id };
	}

	/** Builds append-only publication evidence from the exact bootstrap command and revision digest. */
	private _BuildAuditDecision(command: PersonalAgentBootstrapCommand, materializedPersonaRevisionId: string, agentRevisionId: string, agentRevisionDigest: string)
	{
		const argumentsDigest = __DigestCanonicalJson({ onboardingId: command.onboardingId, onboardingPersonaRevisionId: command.onboardingPersonaRevisionId, materializedPersonaRevisionId, readinessKind: command.readinessKind, provisionedAt: command.provisionedAt.toISOString() });
		const effectiveAuthorizationDigest = __DigestCanonicalJson({ actor: command.subjectId, siloId: command.siloId, personaRevisionId: materializedPersonaRevisionId, agentRevisionDigest });
		const decisionDigest = __DigestCanonicalJson({ argumentsDigest, effectiveAuthorizationDigest, action: "publish", resourceId: command.onboardingId });
		return {
			decisionDigest,
			siloId: command.siloId,
			actorKind: "user" as const,
			actorId: command.subjectId,
			resourceKind: "agent-service",
			resourceId: command.onboardingId,
			agentServiceId: command.onboardingId,
			agentRevisionId,
			action: "publish",
			catalogId: _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID,
			catalogRevision: 1,
			catalogDigest: __DigestCanonicalJson({ catalog: _PERSONAL_AGENT_BOOTSTRAP_CATALOG_ID, revision: 1 }),
			argumentsDigest,
			policyRevisionHash: __DigestCanonicalJson({ policy: "personal-agent-bootstrap", revision: 1 }),
			effectiveAuthorizationDigest,
			outcome: "allow" as const,
			reasonCode: "onboarding_completed",
			decidedAt: command.provisionedAt,
		};
	}
}
