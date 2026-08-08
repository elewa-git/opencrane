/** Finite entry kinds supported by the shared ledger-card treatment. */
export enum LedgerCardKinds
{
	/** Evidence observed from retrieved context. */
	Observation = "observation",
	/** Policy applied while producing the result. */
	Policy = "policy",
	/** Action performed or prepared by the agent. */
	Action = "action"
}
