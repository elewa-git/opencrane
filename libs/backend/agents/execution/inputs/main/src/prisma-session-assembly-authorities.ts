import type { RunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";

import { PrismaApprovedPersonaSource } from "./prisma-approved-persona-source.js";
import { PrismaMemoryScopeSource } from "./prisma-memory-scope-source.js";
import { PrismaPreferenceFactSource } from "./prisma-preference-fact-source.js";
import { PrismaRevisionBudgetPolicySource, PrismaRevisionToolPolicySource } from "./prisma-revision-tool-policy-source.js";
import { PrismaRunAuthoritySource } from "./prisma-run-authority-source.js";
import { PrismaThreadContextSource } from "./prisma-thread-context-source.js";
import type { IdentityEnvelopeSource, SessionAssemblyAuthorities } from "./session-assembly.types.js";

/** Compose all local transaction-backed inputs while keeping signed identity at the app trust boundary. */
export function __CreatePrismaSessionAssemblyAuthorities(admission: RunAdmissionRepository, identityEnvelope: IdentityEnvelopeSource): SessionAssemblyAuthorities
{
	return {
		admission,
		runAuthority: new PrismaRunAuthoritySource(),
		approvedPersona: new PrismaApprovedPersonaSource(),
		threadContext: new PrismaThreadContextSource(),
		preferenceFacts: new PrismaPreferenceFactSource(),
		memoryScope: new PrismaMemoryScopeSource(),
		toolPolicy: new PrismaRevisionToolPolicySource(),
		budgetPolicy: new PrismaRevisionBudgetPolicySource(),
		identityEnvelope,
	};
}
