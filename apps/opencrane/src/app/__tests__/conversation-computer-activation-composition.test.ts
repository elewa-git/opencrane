import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerActivationConsumerStates } from "@opencrane/backend/server/conversations";
import type { HistoryPersistentSubscription, HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { AgentSandboxReleaseProfileConfig } from "../config.types";

const _log = vi.hoisted(function _HoistedLog() { return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }; });

vi.mock("../log", function _Log() { return { _log }; });

import { _StartConversationComputerActivationWorker } from "../conversation-computer-activation-composition";

const _PROFILE: AgentSandboxReleaseProfileConfig = { profileRevisionId: `sha256:${"a".repeat(64)}`, profileName: "developer", warmPoolName: "developer-pool", namespace: "testv5-computers", serviceAccountName: "computer", leaseTtlMilliseconds: 3_600_000, maximumTurnCostUsdMicros: 1 };

/** A subscription that never delivers, so the composition's lifecycle is the only thing under test. */
function _IdleSubscription(): HistoryPersistentSubscription
{
	return { events: { [Symbol.asyncIterator]() { return { next() { return new Promise(function _Never() {}); } }; } }, acknowledge: vi.fn(), retry: vi.fn(), park: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
}

/** A history store whose only observed call is the persistent subscribe. */
function _HistoryStore(subscribePersistent: HistoryStore["subscribePersistent"]): HistoryStore
{
	return { subscribePersistent } as unknown as HistoryStore;
}

const _instantWait = vi.fn(async function _InstantWait() {});

afterEach(function _Reset() { vi.clearAllMocks(); });

describe("conversation computer activation worker composition", function _Suite()
{
	it("joins the silo consumer group as one competing consumer and closes it on stop", async function _JoinsAndStops()
	{
		const subscription = _IdleSubscription();
		const subscribePersistent = vi.fn().mockResolvedValue(subscription);

		const worker = await _StartConversationComputerActivationWorker({} as PrismaClient, {} as k8s.CustomObjectsApi, _HistoryStore(subscribePersistent), "silo-1", _PROFILE);
		await vi.waitFor(function _Subscribed() { expect(worker.health().state).toBe(ConversationComputerActivationConsumerStates.Subscribed); });
		await worker.stop();

		expect(subscribePersistent).toHaveBeenCalledWith({ streamName: "computer-activations-silo-1", groupName: "conversation-computer-activation" });
		expect(subscription.close).toHaveBeenCalledOnce();
		expect(worker.health().state).toBe(ConversationComputerActivationConsumerStates.Stopped);
		expect(_log.info).toHaveBeenCalledWith(expect.objectContaining({ streamName: "computer-activations-silo-1" }), "conversation computer activation consumer subscribed");
	});

	it("logs a dropped subscription and reopens instead of ending the process", async function _ReopensQuietly()
	{
		const subscribePersistent = vi.fn().mockRejectedValueOnce(new Error("kurrentdb restarting")).mockResolvedValue(_IdleSubscription());
		const onExhausted = vi.fn();

		const worker = await _StartConversationComputerActivationWorker({} as PrismaClient, {} as k8s.CustomObjectsApi, _HistoryStore(subscribePersistent), "silo-1", _PROFILE, { onExhausted, wait: _instantWait });
		await vi.waitFor(function _Reopened() { expect(subscribePersistent).toHaveBeenCalledTimes(2); });
		await worker.stop();

		expect(_log.warn).toHaveBeenCalledWith(expect.objectContaining({ consecutiveFailures: 1, nextWaitMilliseconds: expect.any(Number) }), "conversation computer activation subscription dropped; reopening");
		expect(_log.fatal).not.toHaveBeenCalled();
		expect(onExhausted).not.toHaveBeenCalled();
	});

	it("asks the process to shut down only after the reopen budget is used, and makes stop fail", async function _GivesUp()
	{
		const subscribePersistent = vi.fn().mockRejectedValue(new Error("kurrentdb unreachable"));
		const onExhausted = vi.fn();

		const worker = await _StartConversationComputerActivationWorker({} as PrismaClient, {} as k8s.CustomObjectsApi, _HistoryStore(subscribePersistent), "silo-1", _PROFILE, { onExhausted, wait: _instantWait, resubscribe: { maxConsecutiveFailures: 2 } });
		await vi.waitFor(function _Exhausted() { expect(onExhausted).toHaveBeenCalledOnce(); });

		expect(subscribePersistent).toHaveBeenCalledTimes(2);
		expect(worker.health()).toEqual({ state: ConversationComputerActivationConsumerStates.Failed, consecutiveFailures: 2 });
		expect(_log.fatal).toHaveBeenCalledWith(expect.objectContaining({ consecutiveFailures: 2 }), "conversation computer activation consumer gave up; requesting process shutdown");
		await expect(worker.stop()).rejects.toThrow("used its reopen budget");
	});
});
