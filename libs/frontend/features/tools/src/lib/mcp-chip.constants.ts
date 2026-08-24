import { McpApprovalStatus, McpConnectionStatus, McpServerType } from "@opencrane/core";
import { ScopeChipTones } from "@opencrane/elements/ui";

/** Label and approved semantic tone for one compact MCP chip. */
interface _McpChipPresentation
{
	/** User-facing compact label. */
	readonly label: string;
	/** Shared semantic tone selected by the tools feature. */
	readonly tone: ScopeChipTones;
}

/** Label, semantic tone, and motion for one connection-status indicator. */
interface _McpConnectionPresentation extends _McpChipPresentation
{
	/** Whether the status dot pulses while work is in progress. */
	readonly pulse: boolean;
}

/** Feature-owned presentation for each Model Context Protocol server model. */
export const MCP_TYPE_CHIPS: Record<McpServerType, _McpChipPresentation> =
{
	[McpServerType.SingleUser]: { label: "single-user", tone: ScopeChipTones.Personal },
	[McpServerType.MultiUser]: { label: "multi-user", tone: ScopeChipTones.Department },
	[McpServerType.RemoteOauth]: { label: "remote-oauth", tone: ScopeChipTones.Info }
};

/** Feature-owned presentation for each catalogue approval lifecycle state. */
export const MCP_APPROVAL_CHIPS: Record<McpApprovalStatus, _McpChipPresentation> =
{
	[McpApprovalStatus.PendingReview]: { label: "pending review", tone: ScopeChipTones.Warning },
	[McpApprovalStatus.Approved]: { label: "approved", tone: ScopeChipTones.Info },
	[McpApprovalStatus.Published]: { label: "published", tone: ScopeChipTones.Success },
	[McpApprovalStatus.Disabled]: { label: "disabled", tone: ScopeChipTones.Neutral }
};

/** Feature-owned presentation for each installed-server connection state. */
export const MCP_CONNECTION_INDICATORS: Record<McpConnectionStatus, _McpConnectionPresentation> =
{
	[McpConnectionStatus.NeedsCredential]: { label: "Needs credential", tone: ScopeChipTones.Warning, pulse: false },
	[McpConnectionStatus.SharedKey]: { label: "Shared key · set by admin", tone: ScopeChipTones.Info, pulse: false }
};
