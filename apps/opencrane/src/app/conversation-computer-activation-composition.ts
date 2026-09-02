import { __RunConversationComputerActivationListener } from "@opencrane/backend/server/conversations";
import type { ConversationComputerActivationAuthority, ConversationComputerActivationProfileResolver, ConversationComputerAgentServiceKind, ConversationComputerProfileSelector } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivationConfig, ConversationComputerActivationProfileConfig } from "./config.types";
import type { OpenCraneConversationComputerActivationWorker } from "./conversation-computer-activation-composition.types";
import { _log } from "./log";

/** Fixed KurrentDB consumer group for one silo's ConversationComputer activation commands. */
const _ACTIVATION_SUBSCRIPTION_GROUP = "opencrane-conversation-computer-activation";

/**
 * Starts the persistent activation consumer for one silo and returns its shutdown boundary.
 *
 * The deploy script creates this group before the process starts, so a server may consume an
 * admitted computer generation without creating a queue or reading another silo's commands. An
 * unexpected listener end terminates the process; leaving a durable consumer dormant would strand
 * deliveries that KurrentDB must redeliver.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts`.
 * @param historyStore - Opens the deployment-provisioned persistent subscription.
 * @param authority - Checks history and requests the Sandbox claim for each delivery.
 * @param siloId - Selects the silo-scoped activation stream.
 * @returns A worker whose `stop` method closes the consumer before KurrentDB closes.
 * @throws {Error} Propagates a failure to open the persistent subscription.
 */
export async function _StartConversationComputerActivationWorker(historyStore: HistoryStore, authority: ConversationComputerActivationAuthority, siloId: string): Promise<OpenCraneConversationComputerActivationWorker>
{
	// 1. Open only the deployment-provisioned per-silo group, never a listener-created queue or global stream.
	const subscription = await historyStore.subscribePersistent({ streamName: `computer-activations-${siloId}`, groupName: _ACTIVATION_SUBSCRIPTION_GROUP });
	const listener = __RunConversationComputerActivationListener(subscription, authority);
	let stopping = false;
	void listener.then(function _StoppedActivationListener()
	{
		if (!stopping)
			_FailActivationListener(new Error("conversation computer activation listener ended unexpectedly"));
	}, function _FailedActivationListener(error: unknown)
	{
		if (!stopping)
			_FailActivationListener(error);
	});

	// 2. Close the consumer before KurrentDB so unfinished commands remain eligible for redelivery.
	return {
		async stop(): Promise<void>
		{
			stopping = true;
			await subscription.close();
			await listener;
		},
	};
}

/**
 * Creates the release-map resolver used to admit a history-bound profile revision.
 *
 * The activation authority cannot select Sandbox resources from queue data or database state. A
 * missing revision or foreign silo returns `null`, which makes the authority park the delivery.
 *
 * Called by: `_Main` in `apps/opencrane/src/index.ts`.
 * @param config - Supplies the validated mounted release map.
 * @param siloId - Restricts resolutions to the local deployment.
 * @returns A resolver that exposes one approved Sandbox profile and warm pool, or no profile.
 */
export function _CreateConversationComputerActivationProfileResolver(config: ConversationComputerActivationConfig, siloId: string): ConversationComputerActivationProfileResolver
{
	return new _ReleaseConversationComputerActivationProfileResolver(config, siloId);
}

/** Creates the release-owned policy that assigns one immutable profile to each resolved service kind. */
export function _CreateConversationComputerAgentServiceProfileSelector(config: ConversationComputerActivationConfig, siloId: string): ConversationComputerProfileSelector
{
	return new _ReleaseConversationComputerAgentServiceProfileSelector(config, siloId);
}

/** Logs and terminates the process because a non-stopping durable activation consumer cannot remain dormant. */
function _FailActivationListener(error: unknown): void
{
	_log.fatal({ err: error }, "conversation computer activation listener stopped unexpectedly");
	process.exit(1);
}

/** Resolves profile revisions from the immutable release map mounted into the server process. */
class _ReleaseConversationComputerActivationProfileResolver
{
	/** Indexes immutable profile revisions once because neither queue data nor database state may select a Sandbox profile. */
	private readonly profiles: ReadonlyMap<string, ConversationComputerActivationProfileConfig>;
	/** Restricts every resolved profile to this process's deployment-scoped persistent subscription. */
	private readonly siloId: string;

	/** Captures the already-validated release map before the subscription begins receiving durable work. */
	public constructor(config: ConversationComputerActivationConfig, siloId: string)
	{
		this.profiles = new Map(config.profiles.map(profile => [profile.profileRevisionId, profile]));
		this.siloId = siloId;
	}

	/** Returns the release-approved resources for a profile in this silo, or null when this release did not admit it. */
	public async resolve(command: { readonly siloId: string; readonly profileRevisionId: string }): Promise<{ readonly namespace: string; readonly serviceAccountName: string; readonly sandboxProfile: string; readonly warmPoolName: string; readonly podLabels: { readonly applicationName: string; readonly releaseName: string } } | null>
	{
		if (command.siloId !== this.siloId)
			return null;
		const profile = this.profiles.get(command.profileRevisionId);
		if (profile === undefined)
			return null;
		return { namespace: profile.namespace, serviceAccountName: profile.serviceAccountName, sandboxProfile: profile.sandboxProfile, warmPoolName: profile.warmPoolName, podLabels: profile.podLabels };
	}
}

/** Selects exactly one configured profile after the service authority has resolved a trusted kind. */
class _ReleaseConversationComputerAgentServiceProfileSelector implements ConversationComputerProfileSelector
{
	/** Holds one immutable profile revision per service kind after startup validation has rejected duplicates. */
	private readonly profileRevisionIds: ReadonlyMap<ConversationComputerAgentServiceKind, string>;
	/** Restricts selections to the local deployment rather than accepting another silo's service kind. */
	private readonly siloId: string;

	/** Indexes the mounted release map before any creation authority can accept a request. */
	public constructor(config: ConversationComputerActivationConfig, siloId: string)
	{
		const profileRevisionIds = new Map<ConversationComputerAgentServiceKind, string>();
		for (const profile of config.profiles)
			for (const kind of profile.agentServiceKinds)
				profileRevisionIds.set(kind, profile.profileRevisionId);
		this.profileRevisionIds = profileRevisionIds;
		this.siloId = siloId;
	}

	/** Returns the fixed profile revision for the exact deployment and service kind, or null when unavailable. */
	public async select(command: { readonly siloId: string; readonly agentServiceKind: ConversationComputerAgentServiceKind }): Promise<{ readonly profileRevisionId: string } | null>
	{
		if (command.siloId !== this.siloId)
			return null;
		const profileRevisionId = this.profileRevisionIds.get(command.agentServiceKind);
		return profileRevisionId === undefined ? null : { profileRevisionId };
	}
}
