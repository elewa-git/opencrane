import { describe, expect, it } from "vitest";

import { ScheduleCursorAdvanceOutcomes } from "../schedule-tick.enums.js";
import { PrismaScheduleCursorRepository } from "../prisma-schedule-tick-repositories.js";
import type { AdvanceScheduleCursorCommand } from "../schedule-ticker-unit-of-work.types.js";

/** Fixed cursor command representing a tick that observed one exact schedule version. */
const _CURSOR_COMMAND: AdvanceScheduleCursorCommand = {
	scheduleId: "schedule-1",
	siloId: "silo-1",
	expectedUpdatedAt: "2026-07-01T00:00:00.000Z",
	expectedLastScheduledAt: "2026-07-01T01:00:00.000Z",
	nextLastScheduledAt: "2026-07-01T02:00:00.000Z",
};

/** Tiny transaction double that records the exact compare-and-set filter sent to Prisma. */
class _CursorTransaction
{
	/** Count returned by the emulated conditional update. */
	private readonly updateCount: number;
	/** Last updateMany argument used by the cursor repository. */
	updateManyArgument: unknown = null;
	/** Schedule delegate containing only the one capability the repository needs. */
	readonly agentServiceSchedule: { readonly updateMany: (argument: unknown) => Promise<{ readonly count: number }> };

	/** Creates a transaction double whose update succeeds or loses its compare-and-set race. */
	constructor(updateCount: number)
	{
		this.updateCount = updateCount;
		this.agentServiceSchedule = { updateMany: this._updateMany.bind(this) };
	}

	/** Records the requested CAS and returns the durable result selected by the test. */
	private async _updateMany(argument: unknown): Promise<{ readonly count: number }>
	{
		this.updateManyArgument = argument;
		return { count: this.updateCount };
	}
}

/** Builds the concrete cursor repository over a narrow Prisma transaction test double. */
function _repository(updateCount: number): { readonly repository: PrismaScheduleCursorRepository; readonly transaction: _CursorTransaction }
{
	const transaction = new _CursorTransaction(updateCount);
	return { repository: new PrismaScheduleCursorRepository(transaction as never), transaction };
}

describe("Prisma schedule cursor repository", function _CursorRepositorySuite()
{
	it("requires the observed schedule version and prior cursor before advancing", async function _FencedAdvance()
	{
		const fixture = _repository(1);
		const result = await fixture.repository.advanceIfUnchanged(_CURSOR_COMMAND);
		expect(result).toEqual({ outcome: ScheduleCursorAdvanceOutcomes.Advanced });
		expect(fixture.transaction.updateManyArgument).toEqual({
			where: {
				id: "schedule-1",
				siloId: "silo-1",
				enabled: true,
				updatedAt: new Date("2026-07-01T00:00:00.000Z"),
				lastScheduledAt: new Date("2026-07-01T01:00:00.000Z"),
			},
			data: { lastScheduledAt: new Date("2026-07-01T02:00:00.000Z") },
		});
	});

	it("reports stale instead of overwriting a cursor changed by another tick or schedule edit", async function _RejectStaleAdvance()
	{
		const fixture = _repository(0);
		const result = await fixture.repository.advanceIfUnchanged(_CURSOR_COMMAND);
		expect(result).toEqual({ outcome: ScheduleCursorAdvanceOutcomes.Stale });
	});
});
