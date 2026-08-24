import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";

/** Runtime profile resolved by the personal-agent controller for every initial personal service. */
const _PERSONAL_AGENT_RUNTIME_PROFILE_NAME = "personal-default";

/**
 * Reviewed product policy applied to the first immutable personal-agent revision.
 *
 * These are per-run technical ceilings, not an account spending ceiling. They are frozen into run
 * input so the runtime can stop reasoning/tool loops, excess token use, and elapsed-time stalls.
 * End-to-end enforcement remains a release qualification requirement; storing this policy alone is
 * not proof that every runtime adapter stops correctly. A later change creates a new AgentRevision.
 */
export const INITIAL_PERSONAL_AGENT_POLICY = Object.freeze({
	promptPolicyVersion: PROMPT_COMPILER_VERSION,
	workloadProfile: _PERSONAL_AGENT_RUNTIME_PROFILE_NAME,
	budget: Object.freeze({
		maxTurns: 64,
		maxTokens: 256_000,
		maxCostUsdMicros: 5_000_000,
		maxDurationMs: 3_600_000,
	}),
});
