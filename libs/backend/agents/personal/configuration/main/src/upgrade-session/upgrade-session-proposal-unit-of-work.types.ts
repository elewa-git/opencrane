import type { UpgradeSessionProposalRepository } from "./upgrade-session.types";

/** Root-client transaction owner for one runtime upgrade-session proposal. */
export interface UpgradeSessionProposalUnitOfWork extends UpgradeSessionProposalRepository
{
}
