/** Read lifecycle for the component-scoped elicitation Activity index. */
export enum ConversationElicitationActivityReadStates
{
	/** No signed-in identity is active, so the store owns no private rows or reads. */
	Idle = "idle",
	/** The active identity has no rows yet and its first read is running. */
	Loading = "loading",
	/** A later read is running after the active identity already reached a settled state. */
	Refreshing = "refreshing",
	/** The most recent visible-page read completed and its unexpired pending rows are available. */
	Ready = "ready",
	/** The read failed and private rows were removed; an explicit refresh may try again. */
	Error = "error",
}
