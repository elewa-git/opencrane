import { describe, expect, it } from "vitest";

import { ManagedRunAdmissionOutcomes } from "@opencrane/backend/server/agents/agent-services";
import type { ManagedRunAdmissionPort, ManagedRunAdmissionResult, ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import { ScheduleCursorAdvanceOutcomes, ScheduleOverlapPolicies } from "../schedule-tick.enums.js";
import { ScheduleTicker } from "../schedule-ticker.js";
import type { AdvanceScheduleCursorCommand, EnabledScheduleSnapshot, ScheduleTickerTransaction, ScheduleTickerUnitOfWork, ScheduleTickerWork } from "../schedule-ticker-unit-of-work.types.js";

/** Fixed enabled schedule snapshot used to prove version-fenced cursor persistence. */
const _SNAPSHOT: EnabledScheduleSnapshot = {
	schedule: {
		id: "schedule-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		cron: "0 * * * *",
		timezone: "UTC",
		overlapPolicy: ScheduleOverlapPolicies.Allow,
		enabled: true,
		catchupWindowSeconds: 86_400,
		lastScheduledAt: "2026-07-01T00:00:00.000Z",
	},
	activeRevisionId: "revision-1",
	updatedAt: "2026-07-01T00:00:00.000Z",
};

/** In-memory unit of work that exposes only scheduler capability repositories to the ticker. */
class _ScheduleTickerUnitOfWork implements ScheduleTickerUnitOfWork
{
	/** Commands offered to the durable cursor compare-and-set repository. */
	readonly cursorCommands: AdvanceScheduleCursorCommand[] = [];
	/** Cursor result selected by the test to model an unchanged or concurrently changed schedule. */
	private readonly cursorOutcome: ScheduleCursorAdvanceOutcomes;

	/** Creates a unit of work that returns the supplied cursor compare-and-set outcome. */
	constructor(cursorOutcome: ScheduleCursorAdvanceOutcomes)
	{
		this.cursorOutcome = cursorOutcome;
	}

	/** Runs work against test-double capability repositories without leaking persistence internals. */
	async run<Result>(work: ScheduleTickerWork<Result>): Promise<Result>
	{
		const transaction: ScheduleTickerTransaction = {
			schedules: { async listEnabledSnapshots(): Promise<readonly EnabledScheduleSnapshot[]> { return [_SNAPSHOT]; } },
			activeScheduledRuns: { async hasActiveScheduledRun(): Promise<boolean> { return false; } },
			cursors: { advanceIfUnchanged: this._advanceIfUnchanged.bind(this) },
		};
		return work(transaction);
	}

	/** Records one compare-and-set command and returns the test-selected durable outcome. */
	private async _advanceIfUnchanged(command: AdvanceScheduleCursorCommand): Promise<{ readonly outcome: ScheduleCursorAdvanceOutcomes }>
	{
		this.cursorCommands.push(command);
		return { outcome: this.cursorOutcome };
	}
}

/** Admission double that records its command and accepts the deterministic due slot. */
class _AcceptingAdmission implements ManagedRunAdmissionPort
{
	/** Every command the scheduler handed to the existing run-admission authority. */
	readonly commands: ManagedRunNowCommand[] = [];

	/** Records one command and returns a durable accepted-run identity. */
	async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
	{
		this.commands.push(command);
		return { outcome: ManagedRunAdmissionOutcomes.Accepted, runId: "run-1" };
	}
}

/** Logger double that records stale cursor diagnostics without producing test output. */
class _Logger
{
	/** Debug records emitted for an expected compare-and-set loss. */
	readonly debugRecords: unknown[] = [];

	/** Records a debug event. */
	debug(record: unknown): void
	{
		this.debugRecords.push(record);
	}

	/** Ignores invalid-schedule warnings because these fixtures remain valid. */
	warn(): void
	{
		return undefined;
	}
}

/** Creates one ticker with test doubles around the unchanged or stale cursor outcome. */
function _ticker(cursorOutcome: ScheduleCursorAdvanceOutcomes): { readonly ticker: ScheduleTicker; readonly unitOfWork: _ScheduleTickerUnitOfWork; readonly admission: _AcceptingAdmission; readonly logger: _Logger }
{
	const unitOfWork = new _ScheduleTickerUnitOfWork(cursorOutcome);
	const admission = new _AcceptingAdmission();
	const logger = new _Logger();
	return { ticker: new ScheduleTicker(unitOfWork, admission, logger as never), unitOfWork, admission, logger };
}

describe("schedule ticker cursor compare-and-set", function _ScheduleTickerSuite()
{
	it("advances the cursor only after the shared admission authority accepts the due slot", async function _AdvanceAfterAdmission()
	{
		const fixture = _ticker(ScheduleCursorAdvanceOutcomes.Advanced);
		await fixture.ticker.runOnce(new Date("2026-07-01T01:30:00.000Z"));
		expect(fixture.admission.commands).toHaveLength(1);
		expect(fixture.unitOfWork.cursorCommands).toEqual([{
			scheduleId: "schedule-1",
			siloId: "silo-1",
			expectedUpdatedAt: "2026-07-01T00:00:00.000Z",
			expectedLastScheduledAt: "2026-07-01T00:00:00.000Z",
			nextLastScheduledAt: "2026-07-01T01:00:00.000Z",
		}]);
	});

	it("leaves a competing newer cursor untouched when the compare-and-set reports stale", async function _RejectStaleCursor()
	{
		const fixture = _ticker(ScheduleCursorAdvanceOutcomes.Stale);
		await fixture.ticker.runOnce(new Date("2026-07-01T01:30:00.000Z"));
		expect(fixture.unitOfWork.cursorCommands).toHaveLength(1);
		expect(fixture.logger.debugRecords).toEqual([{ scheduleId: "schedule-1" }]);
	});
});
