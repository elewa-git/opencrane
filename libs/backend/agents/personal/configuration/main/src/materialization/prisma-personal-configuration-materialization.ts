import { PersonalConfigurationChangeState, Prisma } from "@prisma/client";

import { __MaterializeAgentRevisionModelSelectionWithinTransaction } from "@opencrane/backend/server/agents/agent-services";

import { _IsPersonalConfigurationPatch } from "../configuration-patch.js";
import type { MaterializePersonalConfigurationChangeCommand, PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";
import type { LockedModelSelectionProposal, ProposalLockResult } from "./prisma-personal-configuration-materialization.types.js";

/**
 * Materializes an accepted personal model selection inside one caller-owned transaction.
 *
 * The procedure follows the profile → proposal → service lock order used by other personal
 * configuration authorities. That order prevents deadlocks while ensuring a concurrent persona or
 * agent revision change cannot invalidate the evidence halfway through materialization.
 *
 * Creating, publishing, and activating the revision and marking the proposal applied must either
 * all commit or all roll back. Retrying an already-applied proposal returns the stored revision and
 * never creates a competing copy.
 *
 * @param transaction - Open Prisma transaction that owns every lock and mutation.
 * @param command - Owner-bound proposal coordinate and trusted materialization time.
 * @returns Stable persistence result for the owner-facing authority.
 */
export async function _MaterializePersonalConfigurationWithinTransaction(transaction: Prisma.TransactionClient, command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>
{
	// 1. Lock the profile and proposal in the shared order, then interpret lifecycle state.
	// This freezes the persona head and makes duplicate owner requests replay-safe.
	const proposalLock = await _LockModelSelectionProposal(transaction, command);
	if (proposalLock.outcome === "terminal") return proposalLock.result;
	const proposal = proposalLock.proposal;

	// 2. Lock the personal service before delegating any revision or activation decisions.
	// This completes the shared lock order and lets agent-services safely prove the frozen head.
	await _LockPersonalService(transaction, command, proposal);

	// 3. Delegate source validation, alias resolution, canonical cloning, and activation.
	// Only the normalized public alias crosses domains; browser input never selects a provider ID.
	const materialized = await __MaterializeAgentRevisionModelSelectionWithinTransaction(transaction, {
		siloId: command.siloId,
		agentServiceId: proposal.agentServiceId,
		expectedSourceRevisionId: proposal.expectedAgentRevisionId,
		expectedPersonaRevisionId: proposal.expectedPersonaRevisionId,
		modelAlias: proposal.modelAlias,
		changeMessage: `Owner accepted model alias: ${proposal.modelAlias}`,
		authoredBy: command.userId,
		materializedAt: new Date(command.materializedAt),
	});
	if (materialized.status === "stale_source") return { status: "stale_proposal" };
	if (materialized.status === "model_unavailable") return { status: "model_unavailable" };

	// 4. Transition only the personal proposal journal after agent-services completes its mutation.
	// A failed final compare-and-set throws so Prisma rolls every agent-service write back as well.
	return _ApplyProposal(transaction, command, materialized.agentRevisionId);
}

/** Lock and validate the owner-bound proposal together with its recorded persona head. */
async function _LockModelSelectionProposal(transaction: Prisma.TransactionClient, command: MaterializePersonalConfigurationChangeCommand): Promise<ProposalLockResult>
{
	const candidate = await transaction.personalConfigurationChange.findFirst({
		where: {
			id: command.changeId,
			siloId: command.siloId,
			userId: command.userId,
		},
		select: { personaProfileId: true },
	});
	if (candidate === null) return _Terminal({ status: "not_found_or_not_owner" });

	const profiles = await transaction.$queryRaw<readonly { readonly activeRevisionId: string | null }[]>(Prisma.sql`
		SELECT "active_revision_id" AS "activeRevisionId"
		FROM "persona_profiles"
		WHERE "id" = ${candidate.personaProfileId}
		  AND "silo_id" = ${command.siloId}
		  AND "user_id" = ${command.userId}
		FOR UPDATE
	`);
	await transaction.$queryRaw(Prisma.sql`
		SELECT "id"
		FROM "personal_configuration_changes"
		WHERE "id" = ${command.changeId}
		  AND "silo_id" = ${command.siloId}
		  AND "user_id" = ${command.userId}
		FOR UPDATE
	`);

	const change = await transaction.personalConfigurationChange.findFirst({
		where: {
			id: command.changeId,
			siloId: command.siloId,
			userId: command.userId,
		},
		select: {
			state: true,
			personaProfileId: true,
			agentServiceId: true,
			expectedPersonaRevisionId: true,
			expectedAgentRevisionId: true,
			requestedPatch: true,
			appliedAgentRevisionId: true,
		},
	});
	if (change === null) return _Terminal({ status: "not_found_or_not_owner" });

	const patch = change.requestedPatch as unknown;
	if (!_IsPersonalConfigurationPatch(patch) || patch.kind !== "model_alias")
	{
		return _Terminal({ status: "not_applicable" });
	}
	if (change.state === PersonalConfigurationChangeState.Applied && change.appliedAgentRevisionId !== null)
	{
		return _Terminal({
			status: "applied",
			agentRevisionId: change.appliedAgentRevisionId,
		});
	}
	if (change.state !== PersonalConfigurationChangeState.Accepted)
	{
		return _Terminal({ status: "not_accepted" });
	}
	if (
		change.expectedAgentRevisionId === null
		|| change.personaProfileId !== candidate.personaProfileId
		|| profiles[0]?.activeRevisionId !== change.expectedPersonaRevisionId
	)
	{
		return _Terminal({ status: "stale_proposal" });
	}

	return {
		outcome: "ready",
		proposal: {
			agentServiceId: change.agentServiceId,
			expectedAgentRevisionId: change.expectedAgentRevisionId,
			expectedPersonaRevisionId: change.expectedPersonaRevisionId,
			modelAlias: patch.modelAlias.trim(),
		},
	};
}

/** Lock the personal service before its owning package validates and mutates revision state. */
async function _LockPersonalService(transaction: Prisma.TransactionClient, command: MaterializePersonalConfigurationChangeCommand, proposal: LockedModelSelectionProposal): Promise<void>
{
	await transaction.$queryRaw(Prisma.sql`
		SELECT "id"
		FROM "agent_services"
		WHERE "id" = ${proposal.agentServiceId}
		  AND "silo_id" = ${command.siloId}
		FOR UPDATE
	`);
}

/** Apply the exact still-accepted owner proposal after agent-services activates its revision. */
async function _ApplyProposal(transaction: Prisma.TransactionClient, command: MaterializePersonalConfigurationChangeCommand, revisionId: string): Promise<PersonalConfigurationMaterializationPersistenceResult>
{
	const applied = await transaction.personalConfigurationChange.updateMany({
		where: {
			id: command.changeId,
			siloId: command.siloId,
			userId: command.userId,
			state: PersonalConfigurationChangeState.Accepted,
		},
		data: {
			state: PersonalConfigurationChangeState.Applied,
			appliedAgentRevisionId: revisionId,
		},
	});
	if (applied.count !== 1)
	{
		throw new Error("personal configuration proposal lost its accepted state while locked");
	}
	return { status: "applied", agentRevisionId: revisionId };
}

/** Wrap a terminal materialization result for the lock-stage discriminated unions. */
function _Terminal(result: PersonalConfigurationMaterializationPersistenceResult): { readonly outcome: "terminal"; readonly result: PersonalConfigurationMaterializationPersistenceResult }
{
	return { outcome: "terminal", result };
}
