import { McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement, McpInstallStates } from "@opencrane/core";

import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds, type PersonalMcpConnectionControlView } from "../my-tools/personal-mcp-connection-control/personal-mcp-connection-control.types";
import { PersonalMcpConnectionOperations, type PersonalMcpConnectionTargetState } from "./personal-mcp-connection.types";
import type { InstalledToolRow } from "./tools-inventory.types";

/** Safe presentation text for server-owned activation failures. */
const _FAILURE_MESSAGES: Readonly<Record<McpConnectionFailureCodes, string>> = {
	[McpConnectionFailureCodes.AuthorityEnded]: "Your access no longer permits this connection.",
	[McpConnectionFailureCodes.EndpointChanged]: "The server endpoint changed. Disconnect before reconnecting.",
	[McpConnectionFailureCodes.CredentialConflict]: "Stored credential state needs recovery before this connection can continue.",
	[McpConnectionFailureCodes.CredentialUnavailable]: "The stored credential could not be verified. Disconnect and reconnect.",
	[McpConnectionFailureCodes.AuthenticationRejected]: "The server rejected the saved credential. Disconnect and reconnect.",
	[McpConnectionFailureCodes.UnsupportedProtocol]: "This server does not support the required MCP protocol.",
	[McpConnectionFailureCodes.DiscoveryRejected]: "The server did not return a usable tool catalogue.",
	[McpConnectionFailureCodes.WorkflowExhausted]: "Connection setup could not finish. Disconnect and try again."
};

/** Build one connection control from authoritative server state and route-scoped user intent. */
export function _PersonalMcpConnectionView(row: InstalledToolRow, state: PersonalMcpConnectionTargetState): PersonalMcpConnectionControlView | null
{
	const controlState = _ControlState(row, state);
	if (controlState === null)
		return null;
	const revokeRetry = state.attempt?.operation === PersonalMcpConnectionOperations.Revoke;
	return {
		controlId: `mcp-connection-${encodeURIComponent(row.server.id).replaceAll("%", "-")}`,
		serverName: row.server.name,
		state: controlState,
		credentialInput: revokeRetry ? PersonalMcpCredentialInputKinds.None : _CredentialInput(row.server.credentialRequirement),
		draft: state.draft,
		canReplace: controlState === PersonalMcpConnectionControlStates.Active,
		canRevoke: controlState === PersonalMcpConnectionControlStates.Active || controlState === PersonalMcpConnectionControlStates.Activating || controlState === PersonalMcpConnectionControlStates.RecoveryRequired,
		failureMessage: row.installed.failureCode === null ? null : _FAILURE_MESSAGES[row.installed.failureCode]
	};
}

/** Select the visible state without inferring credential needs from connection presentation. */
function _ControlState(row: InstalledToolRow, state: PersonalMcpConnectionTargetState): PersonalMcpConnectionControlStates | null
{
	if (row.installed.lifecycleState === McpInstallStates.Removing)
		return PersonalMcpConnectionControlStates.Removing;
	if (state.attempt?.ambiguous === true)
		return PersonalMcpConnectionControlStates.Ambiguous;
	if (state.replacing && row.installed.connectionStatus === McpConnectionStatus.Active)
		return PersonalMcpConnectionControlStates.Replace;
	switch (row.installed.connectionStatus)
	{
		case McpConnectionStatus.NeedsCredential: return PersonalMcpConnectionControlStates.Connect;
		case McpConnectionStatus.Activating: return PersonalMcpConnectionControlStates.Activating;
		case McpConnectionStatus.Active: return PersonalMcpConnectionControlStates.Active;
		case McpConnectionStatus.RecoveryRequired: return PersonalMcpConnectionControlStates.RecoveryRequired;
		case McpConnectionStatus.Credentialless: return null;
	}
}

/** Map the explicit server credential requirement to the only supported browser input shape. */
function _CredentialInput(requirement: McpCredentialRequirement): PersonalMcpCredentialInputKinds
{
	return requirement === McpCredentialRequirement.Credentialless ? PersonalMcpCredentialInputKinds.None : PersonalMcpCredentialInputKinds.Bearer;
}
