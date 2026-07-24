import { AgentRevisionState, AgentServiceKind, Prisma } from "@prisma/client";
import type { PersonalConfigurationMaterializationSource, SessionAssemblyCommand, SessionAssemblyLoad } from "@opencrane/backend/agents/execution/inputs";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import { __CreatePersonalRevisionCloneData, __IsValidPersonalRevisionBudget, _PERSONAL_REVISION_INCLUDE } from "./personal-revision-clone.js";
import type { PersonalConfigurationMaterializationResult } from "./personal-configuration-materializer.types.js";

/** Prisma implementation that consumes one accepted model choice in the caller's admission transaction. */
export class PrismaPersonalConfigurationMaterializer implements PersonalConfigurationMaterializationSource
{
	/** Reconciles one oldest accepted change without opening a nested transaction. */
	async materialize(command: SessionAssemblyCommand, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<PersonalConfigurationMaterializationResult>>
	{
		const prisma = transaction.prisma;

		// 1. Serialise one user's change queue so two concurrent admissions cannot materialise two heads.
		await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.siloId}\u0000${command.executionSubjectId}\u0000personal-configuration-materialization`}, 0))`);

		// 2. Lock the owning profile before its service, matching the proposal authority's durable order.
		await prisma.$queryRaw(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "silo_id" = ${command.siloId} AND "user_id" = ${command.executionSubjectId} FOR UPDATE`);
		const profile = await prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId: command.siloId, userId: command.executionSubjectId } }, select: { id: true, activeRevisionId: true } });
		if (profile === null) return _unchanged();

		// 3. Consume stale candidates first and apply at most one current model change for this admission.
		for (;;)
		{
			const candidateId = await _oldestAcceptedCandidateId(prisma, command, profile.id);
			if (candidateId === null) return _unchanged();
			const change = await prisma.personalConfigurationChange.findUnique({ where: { id: candidateId }, select: { id: true, agentServiceId: true, expectedPersonaRevisionId: true, expectedAgentRevisionId: true, requestedPatch: true } });
			if (change === null) continue;

			if (!_isModelAliasPatch(change.requestedPatch)) return _unchanged();
			await prisma.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${change.agentServiceId} AND "silo_id" = ${command.siloId} FOR UPDATE`);
			const service = await prisma.agentService.findFirst({ where: { id: change.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { id: true, activeRevisionId: true } });
			if (service === null || service.activeRevisionId === null || service.activeRevisionId !== change.expectedAgentRevisionId || profile.activeRevisionId !== change.expectedPersonaRevisionId)
			{
				await _supersede(prisma, change.id);
				continue;
			}

			const modelDefinitionId = await _resolveGlobalModelDefinitionId(prisma, change.requestedPatch.modelAlias);
			if (modelDefinitionId === null)
			{
				await _supersede(prisma, change.id);
				continue;
			}
			const head = await prisma.agentRevision.findFirst({ where: { id: service.activeRevisionId, agentServiceId: service.id }, include: _PERSONAL_REVISION_INCLUDE });
			if (head === null || head.personaRevisionId === null || head.modelDefinitionId === modelDefinitionId || !__IsValidPersonalRevisionBudget(head.budget))
			{
				await _supersede(prisma, change.id);
				continue;
			}

			// 4. Clone all immutable revision content, publish it, advance the active pointer, then seal the journal row.
			const createdAt = new Date(transaction.admittedAt);
			const revision = await prisma.agentRevision.create({ data: __CreatePersonalRevisionCloneData(head, { modelDefinitionId, personaRevisionId: head.personaRevisionId, authoredBy: command.executionSubjectId, changeMessage: "Accepted personal model preference", createdAt }), select: { id: true } });
			await prisma.agentRevision.update({ where: { id: revision.id }, data: { state: AgentRevisionState.Published, publishedAt: createdAt } });
			await prisma.agentService.update({ where: { id: service.id }, data: { activeRevisionId: revision.id, updatedAt: createdAt } });
			await prisma.personalConfigurationChange.update({ where: { id: change.id }, data: { state: "Applied", appliedPersonaRevisionId: profile.activeRevisionId, appliedAgentRevisionId: revision.id } });
			return { outcome: "loaded", value: { state: "materialized" } };
		}
	}
}

/** Returns a successful no-op result when no accepted model change can advance this admission. */
function _unchanged(): SessionAssemblyLoad<PersonalConfigurationMaterializationResult>
{
	return { outcome: "loaded", value: { state: "unchanged" } };
}

/** Locks and selects the oldest accepted change for the exact profile, service admission, and user. */
async function _oldestAcceptedCandidateId(prisma: Prisma.TransactionClient, command: SessionAssemblyCommand, personaProfileId: string): Promise<string | null>
{
	const rows = await prisma.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "personal_configuration_changes" WHERE "silo_id" = ${command.siloId} AND "user_id" = ${command.executionSubjectId} AND "persona_profile_id" = ${personaProfileId} AND "agent_service_id" = ${command.agentServiceId} AND "state" = 'accepted'::"PersonalConfigurationChangeState" AND "requested_patch"->>'kind' = 'model_alias' ORDER BY "proposed_at" ASC, "id" ASC LIMIT 1 FOR UPDATE`);
	return rows[0]?.id ?? null;
}

/** Returns whether database JSON is one closed model-alias request rather than an unchecked patch. */
function _isModelAliasPatch(value: Prisma.JsonValue): value is { readonly kind: "model_alias"; readonly modelAlias: string }
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value as { readonly kind?: unknown; readonly modelAlias?: unknown };
	return candidate.kind === "model_alias" && typeof candidate.modelAlias === "string";
}

/** Resolves a globally registered model because session admission has no trusted ClusterTenant identity. */
async function _resolveGlobalModelDefinitionId(prisma: Prisma.TransactionClient, alias: string): Promise<string | null>
{
	const rows = await prisma.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "model_definitions" WHERE "public_model_name" = ${alias} AND "scope" = 'global'::"ModelRoutingScope" ORDER BY "id" ASC LIMIT 1 FOR KEY SHARE`);
	return rows[0]?.id ?? null;
}

/** Marks a stale accepted model request terminal without inventing application evidence. */
async function _supersede(prisma: Prisma.TransactionClient, changeId: string): Promise<void>
{
	await prisma.personalConfigurationChange.update({ where: { id: changeId }, data: { state: "Superseded" } });
}
