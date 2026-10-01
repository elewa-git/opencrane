/**
 * Selects the final-answer format frozen by the prompt compiler and read by the model gateway.
 * These closed string values are included in the compiled-input digest and saved turn input;
 * changing them changes replay and requires a compiler-version change. Unknown modes are rejected.
 * This is a format choice, not a lifecycle state or permission to perform an action.
 */
export enum CompiledFinalOutputModes
{
	/** The final response is literal text, including any JSON-looking text; no display is decoded. */
	Text = "text",
	/** The final response is a JSON answer envelope with required text and an optional static display. */
	Conversation = "conversation",
}
