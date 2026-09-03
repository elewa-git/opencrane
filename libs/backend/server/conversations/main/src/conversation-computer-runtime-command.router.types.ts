import type { ConversationComputerRuntimeCommandEnvelope, ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";

import type { ConversationComputerRuntimeCommandPollCommand } from "./conversation-computers/conversation-computer-runtime-command-authority.types";
import type { ConversationComputerRuntimeAdmissionDependencies } from "./conversation-computer-runtime-admission.types";

/** Selects and completes durable commands after the router has authenticated the Sandbox Pod. */
export interface ConversationComputerRuntimeCommandAuthorityPort
{
	/** Selects the oldest command still awaiting a terminal report. */
	poll(command: ConversationComputerRuntimeCommandPollCommand): Promise<{ readonly command: ConversationComputerRuntimeCommandEnvelope | null }>;
	/** Records one terminal report only when it matches the current head command. */
	complete(command: ConversationComputerRuntimeCommandPollCommand & { readonly report: ConversationComputerRuntimeTerminalReport }): Promise<void>;
}

/** Redeems one server-selected encrypted input body after command queue admission. */
export interface ConversationComputerRuntimeCommandPayloadReader
{
	/** Returns plaintext only when the durable reference and its server-derived ownership coordinates match. */
	readText(command: { readonly siloId: string; readonly conversationId: string; readonly idempotencyKey: string; readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }): Promise<string>;
}

/** Gives the Sandbox the sole runnable command plus its server-redeemed input text. */
export interface ConversationComputerRuntimeWorkPackage
{
	/** Carries the command fences that must accompany every output and terminal report. */
	readonly command: Omit<ConversationComputerRuntimeCommandEnvelope, "payload">;
	/** Names the participant entry that caused this turn. */
	readonly inputEntryId: string;
	/** Carries the protected plaintext after server-side payload redemption. */
	readonly inputText: string;
}

/** Binds the internal runtime command route to identity, history, and durable command authority. */
export interface ConversationComputerRuntimeCommandRouterDependencies extends ConversationComputerRuntimeAdmissionDependencies
{
	/** Selects and completes the execution-fenced command queue. */
	readonly authority: ConversationComputerRuntimeCommandAuthorityPort;
	/** Redeems the oldest admitted command's input without exposing a general payload reader. */
	readonly payloads: ConversationComputerRuntimeCommandPayloadReader;
}
