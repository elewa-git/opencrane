import type { AgUiSseRecord } from "./ag-ui-projection.types.js";

/** Encode one AG-UI event as an SSE record, escaped so a payload cannot forge extra SSE fields. */
export function __EncodeAgUiSseRecord(record: AgUiSseRecord): string
{
	if (record.id !== undefined && /[\r\n]/u.test(record.id))
	{
		throw new TypeError("invalid SSE cursor");
	}
	const id = record.id === undefined ? "" : `id: ${record.id}\n`;
	return `${id}event: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}
