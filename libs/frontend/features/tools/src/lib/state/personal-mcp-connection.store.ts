import { DestroyRef, Injectable, effect, inject, signal, untracked } from "@angular/core";
import { McpConnectionCredentialKinds } from "@opencrane/contracts";
import { McpConnectionStatus, McpCredentialRequirement, McpInstallStates, _RandomId } from "@opencrane/core";
import { MCP_GATEWAY, McpConnectionCommandError, McpConnectionCommandFailureKinds, type McpConnectionCommand } from "@opencrane/state/mcp/adapter";

import type { PersonalMcpConnectionControlView } from "../my-tools/personal-mcp-connection-control/personal-mcp-connection-control.types";
import { _PersonalMcpConnectionView } from "./personal-mcp-connection.mapper";
import { PersonalMcpConnectionOperations, type PersonalMcpConnectionAttempt, type PersonalMcpConnectionTargetState } from "./personal-mcp-connection.types";
import { ToolsInventoryStore } from "./tools-inventory.store";
import type { InstalledToolRow, ToolConnectionCoordinate } from "./tools-inventory.types";

const _EMPTY_STATE: PersonalMcpConnectionTargetState = { draft: "", replacing: false, attempt: null, error: null };

/** Owns personal MCP connection drafts, exact retries and command-result adoption for one tools route. */
@Injectable()
export class PersonalMcpConnectionStore
{
	/** Transport supplied by the application. */
	private readonly _gateway = inject(MCP_GATEWAY);
	/** Authoritative inventory and shared per-server command admission. */
	private readonly _inventory = inject(ToolsInventoryStore);
	/** Private state that must disappear with the route. */
	private readonly _targets = signal<ReadonlyMap<string, PersonalMcpConnectionTargetState>>(new Map());
	/** Safe access-loss message shown until the route is rebuilt. */
	private readonly _accessError = signal<string | null>(null);
	/** Latest inventory access-loss event already applied to private route state. */
	private _handledAccessLossRevision = 0;
	/** Removes private state when authoritative installation coordinates change. */
	private readonly _reconcileEffect = effect(this._Reconcile.bind(this));

	constructor()
	{
		inject(DestroyRef).onDestroy(this._PurgeAll.bind(this));
	}

	/** Build the presentational control for one installed row. */
	public view(row: InstalledToolRow): PersonalMcpConnectionControlView | null
	{
		return _PersonalMcpConnectionView(row, this._State(row.server.id));
	}

	/** Whether transport currently owns this server's shared command scope. */
	public busy(serverId: string): boolean { return this._inventory.busy().has(serverId); }

	/** Fixed command failure text for this server, or the route-wide access-loss result. */
	public error(serverId: string): string | null { return this._accessError() ?? this._State(serverId).error; }

	/** Update the only in-memory bearer copy while no admitted command owns it. */
	public setDraft(serverId: string, draft: string): void
	{
		const current = this._State(serverId);
		if (current.attempt !== null || this.busy(serverId))
			return;
		this._Set(serverId, { ...current, draft, error: null });
	}

	/** Open a fresh replacement form for the current Active generation. */
	public replace(serverId: string): void
	{
		const row = this._Row(serverId);
		if (row === null || row.installed.lifecycleState !== McpInstallStates.Installed || row.installed.connectionStatus !== McpConnectionStatus.Active || this._inventory.commandReserved(serverId))
			return;
		this._Set(serverId, { draft: "", replacing: true, attempt: null, error: null });
	}

	/** Cancel an unsent replacement and erase its bearer draft. */
	public cancelDraft(serverId: string): void
	{
		const current = this._State(serverId);
		if (current.attempt === null)
			this._Delete(serverId);
	}

	/** Start Connect or Replace, or retry the exact ambiguous Activate or Revoke command. */
	public async submit(serverId: string): Promise<void>
	{
		const current = this._State(serverId);
		if (current.attempt?.ambiguous === true)
		{
			if (current.attempt.operation === PersonalMcpConnectionOperations.Revoke)
				await this._RunRevoke(serverId, current.attempt);
			else
				await this._RunActivation(serverId, current.attempt);
			return;
		}
		const row = this._Row(serverId);
		const coordinate = this._inventory.coordinate(serverId);
		if (row === null || coordinate === null || row.installed.lifecycleState !== McpInstallStates.Installed)
			return;
		const kind = row.server.credentialRequirement === McpCredentialRequirement.Credentialless ? McpConnectionCredentialKinds.None : McpConnectionCredentialKinds.Bearer;
		if (kind === McpConnectionCredentialKinds.Bearer && (current.draft.length < 1 || current.draft.length > 8192))
			return;
		if (row.installed.connectionStatus !== McpConnectionStatus.NeedsCredential && !(row.installed.connectionStatus === McpConnectionStatus.Active && current.replacing))
			return;
		if (!this._inventory.reserveCommand(serverId))
			return;
		const attempt: PersonalMcpConnectionAttempt = { operation: PersonalMcpConnectionOperations.Activate, idempotencyKey: _RandomId(), credentialKind: kind, coordinate, ambiguous: false };
		this._Set(serverId, { ...current, attempt, error: null });
		await this._RunActivation(serverId, attempt);
	}

	/** Revoke the current generation or retry its retained ambiguous command. */
	public async revoke(serverId: string): Promise<void>
	{
		const current = this._State(serverId);
		if (current.attempt?.ambiguous === true && current.attempt.operation === PersonalMcpConnectionOperations.Revoke)
		{
			await this._RunRevoke(serverId, current.attempt);
			return;
		}
		const row = this._Row(serverId);
		const coordinate = this._inventory.coordinate(serverId);
		const revocable = row?.installed.connectionStatus === McpConnectionStatus.Active || row?.installed.connectionStatus === McpConnectionStatus.Activating || row?.installed.connectionStatus === McpConnectionStatus.RecoveryRequired;
		if (row === null || coordinate === null || coordinate.connectionGeneration === null || row.installed.lifecycleState !== McpInstallStates.Installed || !revocable || !this._inventory.reserveCommand(serverId))
			return;
		const attempt: PersonalMcpConnectionAttempt = { operation: PersonalMcpConnectionOperations.Revoke, idempotencyKey: _RandomId(), credentialKind: McpConnectionCredentialKinds.None, coordinate, ambiguous: false };
		this._Set(serverId, { draft: "", replacing: false, attempt, error: null });
		await this._RunRevoke(serverId, attempt);
	}

	/** Submit one activation using only the draft frozen behind its attempt. */
	private async _RunActivation(serverId: string, attempt: PersonalMcpConnectionAttempt): Promise<void>
	{
		if (!this._BeginAttempt(serverId, attempt))
			return;
		const draft = this._State(serverId).draft;
		const credential = attempt.credentialKind === McpConnectionCredentialKinds.None
			? { kind: McpConnectionCredentialKinds.None } as const
			: { kind: McpConnectionCredentialKinds.Bearer, token: draft } as const;
		const command: McpConnectionCommand = { idempotencyKey: attempt.idempotencyKey, expectedGeneration: attempt.coordinate.connectionGeneration, credential };
		try
		{
			const projection = await this._gateway.activatePersonalConnection(serverId, command);
			this._Resolve(serverId, attempt, projection, attempt.coordinate);
		}
		catch (error) { this._Reject(serverId, attempt, error); }
	}

	/** Submit one revocation with the retained idempotency key and no credential material. */
	private async _RunRevoke(serverId: string, attempt: PersonalMcpConnectionAttempt): Promise<void>
	{
		if (!this._BeginAttempt(serverId, attempt))
			return;
		try
		{
			const projection = await this._gateway.revokePersonalConnection(serverId, attempt.idempotencyKey, _RequiredGeneration(attempt.coordinate));
			this._Resolve(serverId, attempt, projection, attempt.coordinate);
		}
		catch (error) { this._Reject(serverId, attempt, error); }
	}

	/** Admit first transport work or resume only this exact retained attempt. */
	private _BeginAttempt(serverId: string, attempt: PersonalMcpConnectionAttempt): boolean
	{
		const current = this._State(serverId);
		if (current.attempt !== attempt || !attempt.ambiguous && !this._Matches(serverId, attempt.coordinate))
			return false;
		if (attempt.ambiguous && this._inventory.coordinate(serverId)?.lifecycleState !== McpInstallStates.Installed)
			return false;
		return attempt.ambiguous ? this._inventory.resumeCommand(serverId) : this._inventory.busy().has(serverId);
	}

	/** Adopt a response only while this attempt and its starting server coordinates remain current. */
	private _Resolve(serverId: string, attempt: PersonalMcpConnectionAttempt, projection: Parameters<ToolsInventoryStore["adoptConnection"]>[1], coordinate: ToolConnectionCoordinate): void
	{
		if (this._State(serverId).attempt !== attempt)
			return;
		this._inventory.adoptConnection(serverId, projection, coordinate);
		this._inventory.finishCommand(serverId);
		this._Delete(serverId);
		this._inventory.reloadInstalled();
	}

	/** Apply the safe command failure category without exposing transport or provider text. */
	private _Reject(serverId: string, attempt: PersonalMcpConnectionAttempt, error: unknown): void
	{
		if (this._State(serverId).attempt !== attempt)
			return;
		const commandError = error instanceof McpConnectionCommandError ? error : new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain);
		if (commandError.kind === McpConnectionCommandFailureKinds.Uncertain)
		{
			this._Set(serverId, { ...this._State(serverId), attempt: { ...attempt, ambiguous: true }, error: commandError.message });
			this._inventory.finishCommand(serverId, true);
			return;
		}
		this._inventory.finishCommand(serverId);
		if (commandError.kind === McpConnectionCommandFailureKinds.AccessChanged)
		{
			this._PurgeAll();
			this._accessError.set(commandError.message);
		}
		else
			this._Set(serverId, { ..._EMPTY_STATE, error: commandError.message });
		this._inventory.reloadInstalled();
	}

	/** Purge private state after access loss or authoritative coordinate replacement. */
	private _Reconcile(): void
	{
		const accessRevision = this._inventory.accessLossRevision();
		const loaded = this._inventory.hasInstalledValue();
		const installations = this._inventory.installations();
		const entitledServerIds = this._inventory.entitledServerIds();
		const targets = this._targets();
		untracked(() =>
		{
			if (accessRevision > this._handledAccessLossRevision)
			{
				this._handledAccessLossRevision = accessRevision;
				this._PurgeAll();
				this._accessError.set("Your access changed. Sign in again to manage connections.");
				return;
			}
			if (!loaded)
				return;
			for (const [serverId, state] of targets)
			{
				const installed = installations.find(record => record.serverId === serverId);
				const stale = entitledServerIds !== null && !entitledServerIds.has(serverId) || installed === undefined || installed.lifecycleState !== McpInstallStates.Installed || state.attempt !== null && !state.attempt.ambiguous && (installed.lifecycleState !== state.attempt.coordinate.lifecycleState || installed.connectionGeneration !== state.attempt.coordinate.connectionGeneration);
				if (stale)
				{
					if (state.attempt !== null)
						this._inventory.finishCommand(serverId);
					this._Delete(serverId);
				}
			}
		});
	}

	/** Release only claims represented by this store, then erase every private draft and retry. */
	private _PurgeAll(): void
	{
		for (const [serverId, state] of this._targets())
		{
			if (state.attempt !== null)
				this._inventory.finishCommand(serverId);
		}
		this._targets.set(new Map());
	}

	/** Whether the installed projection still matches the attempt's starting coordinates. */
	private _Matches(serverId: string, coordinate: ToolConnectionCoordinate): boolean
	{
		const current = this._inventory.coordinate(serverId);
		return current?.lifecycleState === coordinate.lifecycleState && current.connectionGeneration === coordinate.connectionGeneration;
	}

	/** Current joined row for a visible installed server. */
	private _Row(serverId: string): InstalledToolRow | null { return this._inventory.rows().find(row => row.server.id === serverId) ?? null; }
	/** Current target state without storing empty controls. */
	private _State(serverId: string): PersonalMcpConnectionTargetState { return this._targets().get(serverId) ?? _EMPTY_STATE; }
	/** Replace one target without retaining a mutable map reference. */
	private _Set(serverId: string, state: PersonalMcpConnectionTargetState): void { this._targets.update(current => new Map(current).set(serverId, state)); }
	/** Remove one target's private state. */
	private _Delete(serverId: string): void { this._targets.update(function _Without(current) { const next = new Map(current); next.delete(serverId); return next; }); }
}

/** Revocation is available only after the server has admitted one generation. */
function _RequiredGeneration(coordinate: ToolConnectionCoordinate): number
{
	if (coordinate.connectionGeneration === null)
		throw new Error("MCP revocation requires an admitted connection generation.");
	return coordinate.connectionGeneration;
}
