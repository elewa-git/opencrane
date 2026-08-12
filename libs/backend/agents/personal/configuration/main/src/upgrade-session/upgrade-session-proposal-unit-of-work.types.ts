import type { UpgradeSessionProposalRepository } from "./upgrade-session.types.js";

/** Root-client transaction owner for one runtime upgrade-session proposal. */
export interface UpgradeSessionProposalUnitOfWork extends UpgradeSessionProposalRepository
{
}
