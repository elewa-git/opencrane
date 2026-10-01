import type { ConversationComputerCredentialIssueCommand, ConversationComputerCredentialReceipt } from "@opencrane/backend/server/conversations";

/** Retains one simulated receipt without creating provider-side credential state. */
export interface SimulatedConversationComputerCredential
{
	readonly command: ConversationComputerCredentialIssueCommand;
	readonly receipt: ConversationComputerCredentialReceipt;
}
