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

/** Binds the internal runtime command route to identity, history, and durable command authority. */
export interface ConversationComputerRuntimeCommandRouterDependencies extends ConversationComputerRuntimeAdmissionDependencies
{
	/** Selects and completes the execution-fenced command queue. */
	readonly authority: ConversationComputerRuntimeCommandAuthorityPort;
}
