import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.validator.js";
import type { PersonalConfigurationPatch } from "../proposal/personal-configuration-patch.types.js";
import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand } from "./personal-configuration-materialization.types.js";
import { _ResolvePersonalConfigurationMaterializationLifecycle, _TerminalProposalResolution } from "./personal-configuration-materialization-state.js";
import { PersonalConfigurationMaterializationLifecycleOutcomes, PersonalConfigurationMaterializationResolutionOutcomes, type PersonalConfigurationMaterializationChange, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";

/**
 * Validates the stored patch and hands it to the strategy for its kind.
 *
 * A model-alias patch is checked and prepared for agent-services; a persona refresh is refused
 * here as `NotApplicable`, because the persona approval flow applies it instead. A patch that is
 * not a supported shape at all is also `NotApplicable`, so a row written by older code can
 * never be half-applied.
 *
 * Called by: {@link PrismaPersonalConfigurationMaterializationRepository.resolve}.
 *
 * @param change - The stored proposal fields, with `requestedPatch` still unvalidated.
 * @param command - Server-derived owner, proposal id and time.
 * @param readActivePersonaRevision - Reads the owner's active persona revision; called only by
 * a strategy that needs it.
 * @returns `Ready` with the fields agent-services needs, or `Terminal` with a final result.
 */
export async function _ResolvePersonalConfigurationMaterializationStrategy(change: PersonalConfigurationMaterializationChange, command: MaterializePersonalConfigurationChangeCommand, readActivePersonaRevision: PersonalConfigurationMaterializationPersonaRevisionReader): Promise<PersonalConfigurationMaterializationResolution>
{
	const patch = change.requestedPatch;
	if (!_IsPersonalConfigurationPatch(patch))
	{
		return _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.NotApplicable });
	}

	switch (patch.kind)
	{
		case AgentConfigPatchKinds.ModelAlias:
			return _MODEL_ALIAS_MATERIALIZATION_STRATEGY.resolve(change, patch, command, readActivePersonaRevision);
		case AgentConfigPatchKinds.PersonaRefresh:
			return _PERSONA_REFRESH_MATERIALIZATION_STRATEGY.resolve();
	}
}

/**
 * What every patch-kind strategy must implement.
 *
 * One strategy per patch kind, so adding a kind means adding a strategy rather than another
 * branch here. A strategy may read, but must never write: all writes happen after it returns
 * `Ready`.
 */
interface PersonalConfigurationMaterializationStrategy<Patch extends PersonalConfigurationPatch>
{
	/** Decides whether this proposal is ready to materialise, or already has its final result. */
	resolve(change: PersonalConfigurationMaterializationChange, patch: Patch, command: MaterializePersonalConfigurationChangeCommand, readActivePersonaRevision: PersonalConfigurationMaterializationPersonaRevisionReader): Promise<PersonalConfigurationMaterializationResolution>;
}

/**
 * Reads the owner's currently active persona revision, or null when the profile is not theirs.
 *
 * Passed in rather than imported so the strategies stay independent of Prisma; the repository
 * binds it to the materialisation transaction before calling a strategy.
 */
type PersonalConfigurationMaterializationPersonaRevisionReader = (personaProfileId: string, command: MaterializePersonalConfigurationChangeCommand) => Promise<string | null>;

/** Strategy for a model-alias change; it prepares the new personal agent revision. */
class _ModelAliasMaterializationStrategy implements PersonalConfigurationMaterializationStrategy<Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.ModelAlias }>>
{
	/** Checks the proposal's state and its persona revision before declaring it ready. */
	async resolve(change: PersonalConfigurationMaterializationChange, patch: Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.ModelAlias }>, command: MaterializePersonalConfigurationChangeCommand, readActivePersonaRevision: PersonalConfigurationMaterializationPersonaRevisionReader): Promise<PersonalConfigurationMaterializationResolution>
	{
		// 1. Read the state first, so a repeat apply or a refusal costs no further queries.
		const lifecycle = _ResolvePersonalConfigurationMaterializationLifecycle(change);
		if (lifecycle.outcome === PersonalConfigurationMaterializationLifecycleOutcomes.Terminal)
		{
			return _TerminalProposalResolution(lifecycle.result);
		}

		// 2. Re-read the active persona revision, because a newer persona must invalidate the accepted model choice.
		const activePersonaRevisionId = await readActivePersonaRevision(change.personaProfileId, command);
		if (change.expectedAgentRevisionId === null || activePersonaRevisionId !== change.expectedPersonaRevisionId)
		{
			return _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.StaleProposal });
		}

		// 3. Pass on only the fields agent-services needs; it owns the revision work itself.
		return {
			outcome: PersonalConfigurationMaterializationResolutionOutcomes.Ready,
			proposal: {
				agentServiceId: change.agentServiceId,
				expectedAgentRevisionId: change.expectedAgentRevisionId,
				expectedPersonaRevisionId: change.expectedPersonaRevisionId,
				modelAlias: patch.modelAlias.trim(),
			},
		};
	}
}

/** Strategy for a persona refresh: it does nothing here, because the persona approval flow applies it. */
class _PersonaRefreshMaterializationStrategy implements PersonalConfigurationMaterializationStrategy<Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.PersonaRefresh }>>
{
	/** Always returns NotApplicable, because the persona approval flow applies this patch kind. */
	async resolve(): Promise<PersonalConfigurationMaterializationResolution>
	{
		return _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.NotApplicable });
	}
}

/** The one strategy used for model-alias changes. */
const _MODEL_ALIAS_MATERIALIZATION_STRATEGY = new _ModelAliasMaterializationStrategy();
/** The persona-refresh strategy, which leaves the work to the persona approval flow. */
const _PERSONA_REFRESH_MATERIALIZATION_STRATEGY = new _PersonaRefreshMaterializationStrategy();
