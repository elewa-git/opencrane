import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";

import type { ProductionExternalActionTransports } from "./external-action-executor.types.js";

/** Concrete server-side transports used by current external-action adapters. */
export interface ProductionExternalActionAdapterDependencies
{
	/** The custody, sandbox, and memory transports. Only the server holds these. */
	readonly transports: ProductionExternalActionTransports;
	/** Writes upgrade-session proposals for the built-in personal configuration tool. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Server clock used to timestamp built-in proposals. */
	readonly now: () => Date;
}
