import type { AgUiSseRecord } from "./ag-ui-projection.types.js";

/** Encode one versioned AG-UI projection as a single, injection-safe SSE record. */
export function __EncodeAgUiSseRecord(record: AgUiSseRecord): string
{
	if (/[\r\n]/u.test(record.id))
	{
		throw new TypeError("invalid SSE cursor");
	}
	return `id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`;
}
