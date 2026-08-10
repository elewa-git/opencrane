import type { AgUiSseRecord } from "./ag-ui-projection.types.js";

/** Encode one versioned AG-UI projection as a single, injection-safe SSE record. */
export function __EncodeAgUiSseRecord(record: AgUiSseRecord): string
{
	if (record.id !== undefined && /[\r\n]/u.test(record.id))
	{
		throw new TypeError("invalid SSE cursor");
	}
	const id = record.id === undefined ? "" : `id: ${record.id}\n`;
	return `${id}event: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}
