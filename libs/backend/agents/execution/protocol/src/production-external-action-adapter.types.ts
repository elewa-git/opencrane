import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";
import type { PersonalMemoryPermissionAuthority } from "@opencrane/backend/agents/execution/elicitation";

import type { ProductionExternalActionTransports } from "./external-action-executor.types";

/** Concrete server-side transports used by current external-action adapters. */
export interface ProductionExternalActionAdapterDependencies
{
	/** The sandbox and memory transports. Only the server holds these. */
	readonly transports: ProductionExternalActionTransports;
	/** Writes upgrade-session proposals for the built-in personal configuration tool. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Exact execution-user receipt verifier for personal-memory recall. */
	readonly personalMemoryPermissions: PersonalMemoryPermissionAuthority;
	/** Trusted server wall clock for built-in proposal evidence. */
	readonly now: () => Date;
}
