/** The three kinds of ledger entry a card can show: an observation, a policy, or an action. */
export enum LedgerCardKinds
{
	/** Something observed in the retrieved context. */
	Observation = "observation",
	/** Policy applied while producing the result. */
	Policy = "policy",
	/** Action performed or prepared by the agent. */
	Action = "action"
}
