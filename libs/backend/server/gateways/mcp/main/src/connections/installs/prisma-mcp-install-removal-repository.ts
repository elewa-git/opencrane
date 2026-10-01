import { McpConnectionState, McpConnectionStatus, McpInstallState, type Prisma } from "@prisma/client";

import { McpInstallStates } from "@opencrane/contracts";

import type { McpInstallRemovalRepository } from "../mcp-connection.types";
import { __PlanMcpInstallLifecycle, McpInstallLifecycleActions, McpInstallLifecycleEvents } from "./mcp-install-lifecycle";

const _INSTALL_STATE: Record<McpInstallState, McpInstallStates> = {
	[McpInstallState.Installed]: McpInstallStates.Installed,
	[McpInstallState.Removing]: McpInstallStates.Removing,
	[McpInstallState.Removed]: McpInstallStates.Removed,
};

/** Persists retained install removal after the connection owner has locked the target. */
export class PrismaMcpInstallRemovalRepository implements McpInstallRemovalRepository
{
	constructor(private readonly _transaction: Prisma.TransactionClient) {}

	async lockForCleanup(installId: string): Promise<McpInstallStates | null>
	{
		const current = await this._transaction.mcpServerInstall.findUnique({ where: { id: installId }, select: { lifecycleState: true } });
		if (!current || current.lifecycleState === McpInstallState.Removed)
			return null;
		const locked = await this._transaction.mcpServerInstall.updateMany({ where: { id: installId, lifecycleState: current.lifecycleState }, data: { lifecycleState: current.lifecycleState } });
		return locked.count === 1 ? _INSTALL_STATE[current.lifecycleState] : null;
	}

	async markRemovedWithoutConnection(installId: string): Promise<boolean>
	{
		const changed = await this._transaction.mcpServerInstall.updateMany({ where: { id: installId, lifecycleState: McpInstallState.Installed, connections: { none: {} } }, data: { lifecycleState: McpInstallState.Removed, connectionStatus: McpConnectionStatus.NeedsCredential } });
		if (changed.count === 1)
			return true;
		const current = await this._transaction.mcpServerInstall.findUnique({ where: { id: installId }, select: { lifecycleState: true } });
		return current?.lifecycleState === McpInstallState.Removed;
	}

	async markRemoving(installId: string): Promise<boolean>
	{
		const changed = await this._transaction.mcpServerInstall.updateMany({ where: { id: installId, lifecycleState: McpInstallState.Installed }, data: { lifecycleState: McpInstallState.Removing } });
		if (changed.count === 1)
			return true;
		const current = await this._transaction.mcpServerInstall.findUnique({ where: { id: installId }, select: { lifecycleState: true } });
		return current?.lifecycleState === McpInstallState.Removing;
	}

	async markRemovedIfSettled(installId: string): Promise<boolean>
	{
		const current = await this._transaction.mcpServerInstall.findUnique({ where: { id: installId }, select: { lifecycleState: true } });
		if (!current)
			return false;
		const lifecycle = __PlanMcpInstallLifecycle(_INSTALL_STATE[current.lifecycleState], McpInstallLifecycleEvents.CleanupCompleted);
		if (lifecycle.action === McpInstallLifecycleActions.NoOp)
			return true;
		if (lifecycle.action === McpInstallLifecycleActions.Deny)
			return false;
		const changed = await this._transaction.mcpServerInstall.updateMany({
			where: { id: installId, lifecycleState: McpInstallState.Removing, connections: { every: { state: McpConnectionState.Revoked, cleanupCompletedAt: { not: null } } } },
			data: { lifecycleState: McpInstallState.Removed, connectionStatus: McpConnectionStatus.NeedsCredential },
		});
		if (changed.count === 1)
			return true;
		const winner = await this._transaction.mcpServerInstall.findUnique({ where: { id: installId }, select: { lifecycleState: true } });
		return winner?.lifecycleState === McpInstallState.Removed;
	}
}
