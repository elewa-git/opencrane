import { ConversationComputerRealizationKinds, type ConversationComputerRealization, type HostDevelopmentConversationComputerRealization } from "@opencrane/contracts";
import { HostConversationComputerProcessOwner, type HostConversationComputerProcessCommand, type HostConversationComputerProcessCoordinates } from "@opencrane/backend/server/infra/conversation-computer-host";
import type { ConversationComputerProcessAuthenticator, ConversationComputerProcessIdentity, ConversationComputerRealizationClaimCommand, ConversationComputerRealizationCommand, ConversationComputerRealizationRenewCommand, ConversationComputerRealizer } from "@opencrane/backend/server/conversations";

import type { HostDevelopmentConversationComputerRealizationOwner, HostDevelopmentConversationComputerRealizerOptions } from "./conversation-computer-host-realizer.types";

/** Adapts neutral host-process ownership to the conversations domain realization ports. */
export class HostDevelopmentConversationComputerRealizer implements ConversationComputerRealizer, ConversationComputerProcessAuthenticator
{
	/** Owns operating-system children, private bearers, lease timers, and cleanup. */
	private readonly processes: HostConversationComputerProcessOwner;

	/** Creates the host-process owner used by the Tier 2 composition root. */
	public constructor(options: HostDevelopmentConversationComputerRealizerOptions)
	{
		this.processes = new HostConversationComputerProcessOwner(options);
	}

	/** Maps a domain reservation to deterministic host-process coordinates. */
	public prepare(command: Omit<ConversationComputerRealizationClaimCommand, "realization">): ConversationComputerRealization
	{
		const coordinates = this.processes.prepare(command);
		return this._Realization(coordinates);
	}

	/** Starts or observes the host process named by the persisted realization. */
	public async claim(command: ConversationComputerRealizationClaimCommand): Promise<ConversationComputerRealization>
	{
		const realization = this._HostRealization(command.realization);
		const coordinates = await this.processes.claim({ siloId: command.siloId, computerId: command.computerId, leaseId: command.leaseId, generation: command.generation, expiresAt: command.expiresAt, coordinates: this._Coordinates(realization) });
		return this._Realization(coordinates);
	}

	/** Reads the host-process deadline through the domain lease coordinates. */
	public async inspect(command: ConversationComputerRealizationCommand)
	{
		return this.processes.inspect(this._Command(command));
	}

	/** Moves the selected host-process deadline without changing its realization. */
	public async renew(command: ConversationComputerRealizationRenewCommand): Promise<"renewed" | "absent">
	{
		return this.processes.renew({ ...this._Command(command), expiresAt: command.expiresAt });
	}

	/** Releases the host process selected by the persisted domain lease. */
	public async release(command: ConversationComputerRealizationCommand): Promise<"released" | "absent">
	{
		return this.processes.release(this._Command(command));
	}

	/** Verifies that a host caller identity belongs to the selected domain lease. */
	public async bind(command: ConversationComputerRealizationCommand & { readonly process: ConversationComputerProcessIdentity }): Promise<boolean>
	{
		if (command.process.kind !== ConversationComputerRealizationKinds.HostDevelopmentProcess)
		{
			return false;
		}
		return this.processes.bind({ ...this._Command(command), process: { processId: command.process.processId } });
	}

	/** Maps a private bearer to the domain identity for its host process. */
	public async authenticate(bearer: string): Promise<ConversationComputerProcessIdentity | null>
	{
		const process = await this.processes.authenticate(bearer);
		if (process === null)
		{
			return null;
		}
		return { kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: process.processId };
	}

	/** Attempts to stop every host process and remove every private bearer file, rejecting on cleanup failure. */
	public async close(): Promise<void>
	{
		await this.processes.close();
	}

	/** Maps a domain lease to the neutral coordinates accepted by the host-process owner. */
	private _Command(command: ConversationComputerRealizationCommand): HostConversationComputerProcessCommand
	{
		const realization = this._HostRealization(command.lease.realization);
		return { computerId: command.computerId, leaseId: command.lease.leaseId, generation: command.lease.leaseGeneration, coordinates: this._Coordinates(realization) };
	}

	/** Removes the domain discriminant before calling the host-process owner. */
	private _Coordinates(realization: HostDevelopmentConversationComputerRealization): HostConversationComputerProcessCoordinates
	{
		return { processId: realization.processId, endpoint: realization.endpoint };
	}

	/** Adds the domain discriminant to neutral host-process coordinates. */
	private _Realization(coordinates: HostConversationComputerProcessCoordinates): HostDevelopmentConversationComputerRealization
	{
		return { kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: coordinates.processId, endpoint: coordinates.endpoint };
	}

	/** Refuses production realizations at the Tier 2 domain bridge. */
	private _HostRealization(realization: ConversationComputerRealization): HostDevelopmentConversationComputerRealization
	{
		if (realization.kind !== ConversationComputerRealizationKinds.HostDevelopmentProcess)
		{
			throw new Error("Host conversation computer requires a workstation realization");
		}
		return realization;
	}
}

/** Creates one domain adapter shared by activation and private-request authentication. */
export function _CreateHostDevelopmentConversationComputerRealization(options: HostDevelopmentConversationComputerRealizerOptions): HostDevelopmentConversationComputerRealizationOwner
{
	const realizer = new HostDevelopmentConversationComputerRealizer(options);
	return { authenticator: realizer, realizer, stop: realizer.close.bind(realizer) };
}
