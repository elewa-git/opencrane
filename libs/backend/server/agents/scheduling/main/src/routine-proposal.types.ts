import type { RequestRoutineProposalCommand, RequestRoutineProposalNotificationEvidence, RequestRoutineProposalReceipt, RequestRoutineProposalSource, RequestRoutineSuggestion } from "@opencrane/backend/server/agents/scheduling/contract";
import type { RoutineProposalReadResponse, RoutineProposalStates } from "@opencrane/contracts";

import type { RoutineCaller } from "./routine-authority.types";
import type { RoutineInstructionEnvelope } from "./routine-instruction.types";

/** Additional authenticated data that prevents proposal ciphertext moving between requesters or chats. */
export interface RoutineProposalCipherContext
{
	readonly siloId: string;
	readonly sourceConversationId: string;
	readonly requesterPrincipalId: string;
	readonly proposalId: string;
}

/** Mounted cipher dedicated to pending routine suggestions. */
export interface RoutineProposalCipher
{
	encrypt(suggestion: RequestRoutineSuggestion, context: RoutineProposalCipherContext): Promise<RoutineInstructionEnvelope>;
	decrypt(envelope: RoutineInstructionEnvelope, context: RoutineProposalCipherContext): Promise<RequestRoutineSuggestion>;
}

/** Opaque proposal identifier allocated before a retryable transaction. */
export interface RoutineProposalIdFactory
{
	proposalId(): string;
}

/** Proposal command after validation, encryption and stable identity allocation. */
export interface CreateRoutineProposalPersistenceCommand extends Omit<RequestRoutineProposalCommand, "suggestion">
{
	readonly proposalId: string;
	readonly suggestion: RoutineInstructionEnvelope;
	readonly argumentsDigest: `sha256:${string}`;
}

/** Requester-bound proposal lookup or cancellation command. */
export interface RoutineProposalAccessCommand
{
	readonly caller: RoutineCaller;
	readonly proposalRef: string;
}

/** Encrypted requester-only projection returned outside its read transaction. */
export interface EncryptedRoutineProposalProjection extends RequestRoutineProposalReceipt, RequestRoutineProposalSource
{
	readonly suggestion: RoutineInstructionEnvelope;
	readonly state: RoutineProposalStates;
	readonly acceptedRoutineId: string | null;
}

/** Transactional persistence for proposal creation, human reads and cancellation. */
export interface RoutineProposalPersistence
{
	propose(command: CreateRoutineProposalPersistenceCommand): Promise<RequestRoutineProposalReceipt>;
	readProposal(command: RoutineProposalAccessCommand): Promise<EncryptedRoutineProposalProjection | null>;
	cancelProposal(command: RoutineProposalAccessCommand): Promise<EncryptedRoutineProposalProjection | null>;
	readCurrent(command: RequestRoutineProposalNotificationEvidence): Promise<RequestRoutineProposalNotificationEvidence | null>;
}

/** Public requester-only projection after decryption. */
export type RoutineProposalProjection = RoutineProposalReadResponse;
