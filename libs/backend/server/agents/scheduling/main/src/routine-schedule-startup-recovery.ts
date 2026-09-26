import type { RoutineWorkflowPersistence } from "./routine-workflow.types";
import type { RoutineScheduleRepairPage, RoutineScheduleRepairPageResult } from "./routine-schedule-repair.types";

/** Reconciles every active schedule head through bounded transaction-owned pages. */
export class RoutineScheduleStartupRecovery
{
	/** Persistence boundary used for each independent repair page. */
	private readonly persistence: Pick<RoutineWorkflowPersistence, "repairActiveSchedulesPage">;
	/** Silo whose schedule heads this recovery owns. */
	private readonly siloId: string;
	/** Maximum page size sent to the persistence boundary. */
	private readonly pageSize: number;

	/** Validates the startup scope and retains the bounded page policy. */
	public constructor(persistence: Pick<RoutineWorkflowPersistence, "repairActiveSchedulesPage">, siloId: string, pageSize = 100)
	{
		if (siloId.trim().length === 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
			throw new Error("routine schedule startup recovery requires a valid silo and page size");
		this.persistence = persistence;
		this.siloId = siloId;
		this.pageSize = pageSize;
	}

	/** Repairs all pages and rejects malformed, repeated, or non-advancing cursors. */
	public async repairAllActiveSchedules(): Promise<number>
	{
		let cursor: string | null = null;
		let total = 0;
		while (true)
		{
			const page: RoutineScheduleRepairPage = { siloId: this.siloId, limit: this.pageSize, afterRoutineId: cursor };
			const result = await this.persistence.repairActiveSchedulesPage(page);
			this._ValidateResult(result, cursor);
			total += result.checked;
			if (result.nextCursor === null)
				return total;
			cursor = result.nextCursor;
		}
	}

	/** Ensures pagination cannot silently repeat or skip a repair page. */
	private _ValidateResult(result: RoutineScheduleRepairPageResult, previousCursor: string | null): void
	{
		if (!Number.isSafeInteger(result.checked) || result.checked < 0 || result.checked > this.pageSize)
			throw new Error("routine schedule startup recovery received an invalid page count");
		if (result.nextCursor !== null && (result.nextCursor.trim().length === 0 || result.nextCursor <= (previousCursor ?? "")))
			throw new Error("routine schedule startup recovery received a non-advancing cursor");
		if (result.checked === this.pageSize && result.nextCursor === null)
			throw new Error("routine schedule startup recovery requires a cursor after a full page");
		if (result.nextCursor !== null && result.checked === 0)
			throw new Error("routine schedule startup recovery received a cursor without checked rows");
	}
}
