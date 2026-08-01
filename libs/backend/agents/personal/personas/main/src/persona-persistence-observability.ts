import { ___DoWithTrace, type Logger } from "@opencrane/observability";

/** Run one persona persistence operation with correlated tracing and exactly one unexpected-error log. */
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
