import type { UpgradeSessionProposalRepository } from "@opencrane/backend/agents/personal/configuration";

import type { ProductionExternalActionTransports } from "./external-action-executor.types.js";

/** Concrete server-side transports used by current external-action adapters. */
export interface ProductionExternalActionAdapterDependencies
{
	/** Credential-custody, sandbox, and memory transports held only by the control plane. */
	readonly transports: ProductionExternalActionTransports;
	/** Built-in personal configuration proposal authority. */
	readonly personalConfiguration: UpgradeSessionProposalRepository;
	/** Trusted server wall clock for built-in proposal evidence. */
	readonly now: () => Date;
}
