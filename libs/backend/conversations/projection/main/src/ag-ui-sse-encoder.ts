import type { AgUiSseRecord } from "@opencrane/contracts";

/**
 * Encodes one versioned AG-UI event as a complete injection-safe Server-Sent Event record.
 *
 * Called by: `__StreamConversationProjection`.
 *
 * @param record Optional durable cursor, fixed event name and validated AG-UI payload.
 * @returns One complete SSE record ending with a blank line.
 * @throws {TypeError} When the cursor contains a carriage return or newline.
 * @see https://www.npmjs.com/package/@ag-ui/core/v/0.0.57
 */
export function __EncodeAgUiSseRecord(record: AgUiSseRecord): string
{
	if (record.id !== undefined && /[\r\n]/u.test(record.id))
	{
		throw new TypeError("invalid SSE cursor");
	}
	const id = record.id === undefined ? "" : `id: ${record.id}\n`;
	return `${id}event: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}
