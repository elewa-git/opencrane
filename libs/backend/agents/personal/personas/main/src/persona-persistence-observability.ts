import { ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

/** Runs one persona persistence operation inside a trace span. An error the caller does not class as expected is logged once, then rethrown either way. */
export async function _DoPersonaPersistenceWithTrace<T>(logger: Logger, operation: string, fields: Record<string, string>, message: string, work: () => Promise<T>, isExpectedError: (err: unknown) => boolean = function _unexpected() { return false; }): Promise<T>
{
	return ___DoWithTrace(operation, fields, async function _tracePersistence()
	{
		try
		{
			return await work();
		}
		catch (err)
		{
			if (!isExpectedError(err)) logger.error({ err, operation, ...fields }, message);
			throw err;
		}
	});
}
