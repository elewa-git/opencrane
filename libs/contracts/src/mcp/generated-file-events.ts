/**
 * Names the file-processing event separately from the earlier MCP completion event.
 * The server derives the operation id from its saved invocation. Receiving this event tells
 * Absurd to read current file state again; the event itself grants no publication or read access.
 */
export function ___GeneratedFileEventName(operationId: string): string
{
	if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(operationId))
		throw new Error("Generated file event requires a saved operation id");
	return `generated-output:${operationId}`;
}
