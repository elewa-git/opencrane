import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import type { PersonalConfigurationPatch } from "../proposal/personal-configuration-patch.types.js";
import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand } from "./personal-configuration-materialization.types.js";
import { _ResolvePersonalConfigurationMaterializationLifecycle, _TerminalProposalResolution } from "./personal-configuration-materialization-state.js";
import { PersonalConfigurationMaterializationLifecycleOutcomes, PersonalConfigurationMaterializationResolutionOutcomes, type PersonalConfigurationMaterializationChange, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";

/** Resolve a persisted patch through its owning materialisation strategy. */
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

/** Strategy contract for one closed personal configuration patch kind. */
interface PersonalConfigurationMaterializationStrategy<Patch extends PersonalConfigurationPatch>
{
	/** Resolves the strategy's proposal evidence into a ready or terminal materialisation result. */
	resolve(change: PersonalConfigurationMaterializationChange, patch: Patch, command: MaterializePersonalConfigurationChangeCommand, readActivePersonaRevision: PersonalConfigurationMaterializationPersonaRevisionReader): Promise<PersonalConfigurationMaterializationResolution>;
}

/** Reads a proposal owner's active persona revision through the owning repository adapter. */
type PersonalConfigurationMaterializationPersonaRevisionReader = (personaProfileId: string, command: MaterializePersonalConfigurationChangeCommand) => Promise<string | null>;

/** Model-alias strategy that prepares an immutable personal agent revision change. */
class _ModelAliasMaterializationStrategy implements PersonalConfigurationMaterializationStrategy<Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.ModelAlias }>>
{
	/** Resolve accepted model-alias evidence while retaining the owner and persona fences. */
	async resolve(change: PersonalConfigurationMaterializationChange, patch: Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.ModelAlias }>, command: MaterializePersonalConfigurationChangeCommand, readActivePersonaRevision: PersonalConfigurationMaterializationPersonaRevisionReader): Promise<PersonalConfigurationMaterializationResolution>
	{
		// 1. Interpret lifecycle before reading later evidence so replay and refusal need no service work.
		const lifecycle = _ResolvePersonalConfigurationMaterializationLifecycle(change);
		if (lifecycle.outcome === PersonalConfigurationMaterializationLifecycleOutcomes.Terminal)
		{
			return _TerminalProposalResolution(lifecycle.result);
		}

		// 2. Reprove the persona head because a newer persona must invalidate the accepted model choice.
		const activePersonaRevisionId = await readActivePersonaRevision(change.personaProfileId, command);
		if (change.expectedAgentRevisionId === null || activePersonaRevisionId !== change.expectedPersonaRevisionId)
		{
			return _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.StaleProposal });
		}

		// 3. Hand only frozen model-alias evidence to agent-services for its own revision lifecycle work.
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

/** Placeholder strategy that keeps persona refresh outside model-revision materialisation. */
class _PersonaRefreshMaterializationStrategy implements PersonalConfigurationMaterializationStrategy<Extract<PersonalConfigurationPatch, { readonly kind: AgentConfigPatchKinds.PersonaRefresh }>>
{
	/** Return the stable result until persona approval owns this patch kind's materialisation. */
	async resolve(): Promise<PersonalConfigurationMaterializationResolution>
	{
		return _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.NotApplicable });
	}
}

/** Sole model-alias strategy registered for immutable personal agent-revision materialisation. */
const _MODEL_ALIAS_MATERIALIZATION_STRATEGY = new _ModelAliasMaterializationStrategy();
/** Persona refresh intentionally delegates to the persona approval authority. */
const _PERSONA_REFRESH_MATERIALIZATION_STRATEGY = new _PersonaRefreshMaterializationStrategy();
