import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, PersonalConfigurationChangeState, Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";
import { ___CanonicalizeJson } from "@opencrane/util";

import { __ProposePersonalConfigurationChange } from "./personal-configuration.js";
import { _IsPersonalConfigurationPatch } from "./configuration-patch.js";
import { __MaterializePersonalConfigurationChange } from "./personal-configuration-materialization.js";
import type { MaterializePersonalConfigurationChangeCommand, PersonalConfigurationChangeMaterializationRepository } from "./personal-configuration-materialization.types.js";
import type { DecidePersonalConfigurationChangeCommand, PersonalConfigurationChangeDecisionRepository, PersonalConfigurationChangeRepository, ProposePersonalConfigurationChangeCommand } from "./personal-configuration.types.js";
import type { UpgradeSessionProposalReceipt, UpgradeSessionProposalRepository } from "./upgrade-session.types.js";

/** Prisma adapter that proves a proposal's user, thread, run, profile, and service bindings atomically. */
export class PrismaPersonalConfigurationChangeRepository implements PersonalConfigurationChangeDecisionRepository, PersonalConfigurationChangeRepository, PersonalConfigurationChangeMaterializationRepository, UpgradeSessionProposalRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** Redacted structured failure logger for this persistence seam. */
	private readonly logger: Logger;

	/** Create the proposal adapter over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Insert one request only after every mutable provenance coordinate agrees in one transaction. */
	async proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: "proposed"; readonly changeId: string } | { readonly status: "provenance_conflict" } | { readonly status: "persistence_unavailable" }>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_configuration.propose", { siloId: command.siloId, userId: command.userId, sourceRunId: command.sourceRunId }, async function _traceProposal()
			{
				return prisma.$transaction(async function _propose(transaction)
				{
				// 1. Verify the personal profile remains owned by the initiating user in this silo.
				const profile = await transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId }, select: { activeRevisionId: true } });
				if (profile === null) return { status: "provenance_conflict" } as const;

				// 2. Verify the conversation, run, and personal service bind the same user and silo.
				const thread = await transaction.conversationThread.findFirst({ where: { id: command.sourceThreadId, siloId: command.siloId, participants: { some: { userId: command.userId } } }, select: { agentServiceId: true } });
				const run = await transaction.agentRun.findFirst({ where: { id: command.sourceRunId, siloId: command.siloId, threadId: command.sourceThreadId, agentServiceId: command.agentServiceId, delegatedUserId: command.userId }, select: { id: true } });
				const service = await transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
				if (thread === null || thread.agentServiceId !== command.agentServiceId || run === null || service === null || profile.activeRevisionId !== command.expectedPersonaRevisionId || service.activeRevisionId !== command.expectedAgentRevisionId) return { status: "provenance_conflict" } as const;

				// 3. Persist only immutable request evidence; later approval owns the sole state transition.
				const change = await transaction.personalConfigurationChange.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, agentServiceId: command.agentServiceId, sourceThreadId: command.sourceThreadId, sourceRunId: command.sourceRunId, sourceMessageId: command.sourceMessageId, requestedPatch: command.requestedPatch as Prisma.InputJsonValue, requestedPatchDigest: command.requestedPatchDigest, expectedPersonaRevisionId: command.expectedPersonaRevisionId, expectedAgentRevisionId: command.expectedAgentRevisionId, proposedAt: new Date(command.proposedAt) }, select: { id: true } });
				return { status: "proposed", changeId: change.id } as const;
				});
			});
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.propose", siloId: command.siloId, sourceRunId: command.sourceRunId }, "Personal configuration proposal persistence failed");
			return _isProvenanceConflict(err) ? { status: "provenance_conflict" } : { status: "persistence_unavailable" };
		}
	}

	/** Compare-and-set an owner decision while retaining immutable proposal provenance. */
	async decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: "accepted" | "rejected" } | { readonly status: "not_found_or_not_owner" | "already_decided" | "persistence_unavailable" }>
	{
		try
		{
			const state = command.decision === "accepted" ? PersonalConfigurationChangeState.Accepted : PersonalConfigurationChangeState.Rejected;
			const updated = await this.prisma.personalConfigurationChange.updateMany({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId, state: PersonalConfigurationChangeState.Proposed }, data: { state, decidedAt: new Date(command.decidedAt), decidedBy: command.userId, rejectionReason: command.rejectionReason } });
			if (updated.count === 1) return { status: command.decision };
			const existing = await this.prisma.personalConfigurationChange.findFirst({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId }, select: { state: true } });
			return existing === null ? { status: "not_found_or_not_owner" } : { status: "already_decided" };
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.decide", siloId: command.siloId, changeId: command.changeId }, "Personal configuration decision persistence failed");
			return { status: "persistence_unavailable" };
		}
	}

	/** Copy an accepted model selection into a fresh personal revision and make only that revision active. */
	async materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<{ readonly status: "applied"; readonly agentRevisionId: string } | { readonly status: "not_applicable" | "not_found_or_not_owner" | "not_accepted" | "stale_proposal" | "model_unavailable" | "persistence_unavailable" }>
	{
		try
		{
			return await this.prisma.$transaction(async function _materialize(transaction)
			{
				// 1. Lock the proposal first so duplicate owner requests cannot create competing future revisions.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "personal_configuration_changes" WHERE "id" = ${command.changeId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				const change = await transaction.personalConfigurationChange.findFirst({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId }, select: { state: true, agentServiceId: true, expectedAgentRevisionId: true, requestedPatch: true } });
				if (change === null) return { status: "not_found_or_not_owner" } as const;
				if (change.state !== PersonalConfigurationChangeState.Accepted) return { status: "not_accepted" } as const;
				const patch = change.requestedPatch as unknown;
				if (!_IsPersonalConfigurationPatch(patch) || patch.kind !== "model_alias") return { status: "not_applicable" } as const;

				// 2. Lock the service and prove the proposal still describes its active personal revision.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${change.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
				const service = await transaction.agentService.findFirst({ where: { id: change.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active }, select: { id: true, activeRevisionId: true } });
				if (service === null || service.activeRevisionId !== change.expectedAgentRevisionId || service.activeRevisionId === null) return { status: "stale_proposal" } as const;
				const base = await transaction.agentRevision.findFirst({ where: { id: service.activeRevisionId, agentServiceId: service.id, state: AgentRevisionState.Published }, include: { skillAssignments: true, integrationAssignments: true, scopeAttachments: true } });
				if (base === null) return { status: "stale_proposal" } as const;

				// 3. Resolve the caller-visible alias in this silo, preferring its tenant definition over a global default.
				const models = await transaction.modelDefinition.findMany({ where: { publicModelName: patch.modelAlias.trim(), OR: [{ scope: ModelRoutingScope.ClusterTenant, clusterTenant: command.siloId }, { scope: ModelRoutingScope.Global, clusterTenant: null }] }, select: { id: true, scope: true } });
				const model = models.find(function _tenant(candidate) { return candidate.scope === ModelRoutingScope.ClusterTenant; }) ?? models.find(function _global(candidate) { return candidate.scope === ModelRoutingScope.Global; });
				if (model === undefined) return { status: "model_unavailable" } as const;
				const content = { promptPolicyVersion: base.promptPolicyVersion, personaRevisionId: base.personaRevisionId, modelDefinitionId: model.id, capabilityCeiling: base.capabilityCeiling, budget: base.budget, skills: base.skillAssignments.map(function _skill(assignment) { return { skillId: assignment.skillId, revisionId: assignment.skillRevisionId }; }), integrationAssignments: base.integrationAssignments.map(function _integration(assignment) { return { integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: assignment.allowedTools }; }), scopeAttachments: base.scopeAttachments.map(function _scope(attachment) { return { scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId }; }) };
				const revision = await transaction.agentRevision.create({ data: { agentServiceId: service.id, revision: base.revision + 1, parentRevisionId: base.id, changeMessage: `Owner accepted model alias: ${patch.modelAlias.trim()}`, state: AgentRevisionState.Draft, digest: _revisionDigest(service.id, base.revision + 1, content), promptPolicyVersion: base.promptPolicyVersion, personaRevisionId: base.personaRevisionId, modelDefinitionId: model.id, capabilityCeiling: base.capabilityCeiling as Prisma.InputJsonValue, budget: base.budget as Prisma.InputJsonValue, authoredBy: command.userId, createdAt: new Date(command.materializedAt), skillAssignments: { create: base.skillAssignments.map(function _skillAssignment(assignment) { return { skillId: assignment.skillId, skillRevisionId: assignment.skillRevisionId }; }) }, integrationAssignments: { create: base.integrationAssignments.map(function _integrationAssignment(assignment) { return { integrationId: assignment.integrationId, siloId: assignment.siloId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: assignment.allowedTools }; }) }, scopeAttachments: { create: base.scopeAttachments.map(function _scopeAttachment(attachment) { return { scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId }; }) } }, select: { id: true } });

				// 4. Publish and activate with the proposal transition in one transaction; any database fence rolls everything back.
				await transaction.agentRevision.update({ where: { id: revision.id }, data: { state: AgentRevisionState.Published, publishedAt: new Date(command.materializedAt) } });
				await transaction.agentService.update({ where: { id: service.id }, data: { activeRevisionId: revision.id, updatedAt: new Date(command.materializedAt) } });
				const applied = await transaction.personalConfigurationChange.updateMany({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId, state: PersonalConfigurationChangeState.Accepted }, data: { state: PersonalConfigurationChangeState.Applied, appliedAgentRevisionId: revision.id } });
				return applied.count === 1 ? { status: "applied", agentRevisionId: revision.id } as const : { status: "stale_proposal" } as const;
			});
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.materialize", siloId: command.siloId, changeId: command.changeId }, "Personal configuration materialization failed");
			return { status: "persistence_unavailable" };
		}
	}

	/** Map one validated built-in tool candidate to the same durable proposal authority. */
	async proposeUpgradeSession(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject non-personal or non-conversation snapshots before deriving any mutable profile coordinate.
		if (snapshot.personaRevisionId === null || snapshot.threadId === null || !_IsPersonalConfigurationPatch(candidate.arguments)) throw new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");

		// 2. Resolve the only profile owned by the immutable execution subject in this silo.
		const profile = await this.prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId } }, select: { id: true } });
		if (profile === null) throw new Error("upgrade_session personal profile is unavailable");

		// 3. Reuse the proposal authority so current-revision provenance is checked atomically at insertion.
		const result = await __ProposePersonalConfigurationChange(this, { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, personaProfileId: profile.id, agentServiceId: snapshot.agentServiceId, sourceThreadId: snapshot.threadId, sourceRunId: snapshot.runId, sourceMessageId: null, requestedPatch: candidate.arguments, requestedPatchDigest: candidate.argumentsDigest, expectedPersonaRevisionId: snapshot.personaRevisionId, expectedAgentRevisionId: snapshot.agentRevisionId, proposedAt: now });
		if (result.outcome !== "proposed") throw new Error(`upgrade_session proposal denied: ${result.reason}`);
		return { changeId: result.changeId };
	}
}

/** Hash the same canonical revision content used by the managed definition authority. */
function _revisionDigest(agentServiceId: string, revision: number, content: { readonly promptPolicyVersion: string; readonly personaRevisionId: string | null; readonly modelDefinitionId: string; readonly capabilityCeiling: Prisma.JsonValue; readonly budget: Prisma.JsonValue; readonly skills: readonly { readonly skillId: string; readonly revisionId: string }[]; readonly integrationAssignments: readonly { readonly integrationId: string; readonly custodyReferenceId: string; readonly allowedTools: readonly string[] }[]; readonly scopeAttachments: readonly { readonly scope: string; readonly subjectType: string; readonly subjectId: string }[] }): string
{
	const capabilityCeiling = content.capabilityCeiling as unknown as readonly { readonly catalog: { readonly catalogId: string; readonly revision: number; readonly digest: string }; readonly capabilityId: string }[];
	const budget = content.budget as { readonly maxTurns: number; readonly maxTokens: number; readonly maxDurationMs: number };
	const canonical = { agentServiceId, revision, promptPolicyVersion: content.promptPolicyVersion, personaRevisionId: content.personaRevisionId, modelDefinitionId: content.modelDefinitionId, capabilityCeiling: capabilityCeiling.map(function _capability(value) { return { catalog: { catalogId: value.catalog.catalogId, revision: value.catalog.revision, digest: value.catalog.digest }, capabilityId: value.capabilityId }; }).sort(function _byCapability(first, second) { return `${first.catalog.catalogId}\u0000${first.catalog.revision}\u0000${first.catalog.digest}\u0000${first.capabilityId}`.localeCompare(`${second.catalog.catalogId}\u0000${second.catalog.revision}\u0000${second.catalog.digest}\u0000${second.capabilityId}`); }), budget: { maxTurns: budget.maxTurns, maxTokens: budget.maxTokens, maxDurationMs: budget.maxDurationMs }, skills: content.skills.map(function _skill(skill) { return { skillId: skill.skillId, revisionId: skill.revisionId }; }), integrationAssignments: content.integrationAssignments.map(function _integration(assignment) { return { integrationId: assignment.integrationId, custodyReferenceId: assignment.custodyReferenceId, allowedTools: [...assignment.allowedTools] }; }), scopeAttachments: content.scopeAttachments.map(function _scope(attachment) { return { scope: attachment.scope, subjectType: attachment.subjectType, subjectId: attachment.subjectId }; }) };
	return `sha256:${createHash("sha256").update(___CanonicalizeJson(canonical), "utf8").digest("hex")}`;
}

/** Recognise the database's explicit business-fence rejection without exposing database details. */
function _isProvenanceConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P0001";
}
