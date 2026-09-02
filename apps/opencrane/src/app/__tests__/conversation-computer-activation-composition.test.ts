import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _CreateConversationComputerActivationProfileResolver, _StartConversationComputerActivationWorker } from "../conversation-computer-activation-composition";
import type { ConversationComputerActivationConfig } from "../config.types";

/** Holds the durable-listener seams because this test owns server composition rather than queue delivery. */
const _activation = vi.hoisted(function _Activation()
{
	let resolveListener: (() => void) | undefined;
	return {
		listener: new Promise<void>(function _CreateListener(resolve) { resolveListener = resolve; }),
		resolveListener: function _ResolveListener() { resolveListener?.(); },
		subscription: { close: vi.fn(async function _Close() { resolveListener?.(); }) },
	};
});

vi.mock("@opencrane/backend/server/conversations", function _Conversations()
{
	return {
		__RunConversationComputerActivationListener: function _RunActivationListener() { return _activation.listener; },
	};
});

vi.mock("../log", function _Log()
{
	return { _log: { fatal: vi.fn() } };
});

/** Supplies the immutable release map mounted by the target server deployment. */
function _ActivationConfig(): ConversationComputerActivationConfig
{
	return {
		profiles: [{ profileRevisionId: "profile-revision-developer-v1", agentServiceKinds: ["personal", "managed"], namespace: "agent-sandbox", serviceAccountName: "agent-sandbox-runtime", sandboxProfile: "developer", warmPoolName: "developer-warm", podLabels: { applicationName: "opencrane", releaseName: "opencrane-testv5" } }],
	};
}

describe("ConversationComputer activation composition", function _ActivationCompositionSuite()
{
	afterEach(function _RestoreProcess()
	{
		vi.restoreAllMocks();
	});

	it("uses the provisioned per-silo subscription and release-owned profile resolver", async function _UsesDurableSubscription()
	{
		const subscribePersistent = vi.fn(async function _SubscribePersistent() { return _activation.subscription; });
		const exit = vi.spyOn(process, "exit").mockImplementation(function _Exit() { return undefined as never; });
		const profiles = _CreateConversationComputerActivationProfileResolver(_ActivationConfig(), "testv5");
		const worker = await _StartConversationComputerActivationWorker({ subscribePersistent } as unknown as HistoryStore, { activate: vi.fn() }, "testv5");

		expect(subscribePersistent).toHaveBeenCalledWith({ streamName: "computer-activations-testv5", groupName: "opencrane-conversation-computer-activation" });
		expect(await profiles.resolve({ siloId: "testv5", profileRevisionId: "profile-revision-developer-v1" })).toEqual({ namespace: "agent-sandbox", serviceAccountName: "agent-sandbox-runtime", sandboxProfile: "developer", warmPoolName: "developer-warm", podLabels: { applicationName: "opencrane", releaseName: "opencrane-testv5" } });
		expect(await profiles.resolve({ siloId: "untrusted-silo", profileRevisionId: "profile-revision-developer-v1" })).toBeNull();
		expect(await profiles.resolve({ siloId: "testv5", profileRevisionId: "unknown-profile" })).toBeNull();

		await worker.stop();

		expect(_activation.subscription.close).toHaveBeenCalledOnce();
		expect(exit).not.toHaveBeenCalled();
	});
});
