import type { PrismaClient } from "@prisma/client";
import { ProductAuthorizationActions } from "@opencrane/models/authorization";

import type { ConversationCaller } from "../authorization/conversation-caller.types";
import type { CompanyAssistantDirectory, ConversationMetadataAuthority, ConversationMetadataDetail, ConversationMetadataSummary, ConversationReviewCoordinates, InitialConversationComputerResolver } from "./conversation-metadata.types";
import { PrismaConversationDirectoryReader } from "./prisma-conversation-directory";
import { PrismaConversationMetadataReader } from "./prisma-conversation-metadata-reader";
import { PrismaConversationCreationUnitOfWork } from "./prisma-conversation-creation";
import { PrismaConversationParticipantLifecycleUnitOfWork } from "./prisma-conversation-participant-lifecycle";

/** Composes participant metadata operations without owning reads or transaction sequencing. */
export class PrismaConversationMetadataUnitOfWork implements ConversationMetadataAuthority
{
	/** Selects current member references and the caller's assistant. */
	private readonly directoryReader: PrismaConversationDirectoryReader;
	/** Reads metadata after current participant and product-authorisation checks. */
	private readonly reader: PrismaConversationMetadataReader;
	/** Establishes history before committing a new conversation projection. */
	private readonly creation: PrismaConversationCreationUnitOfWork;
	/** Writes archive and close changes in their own authorised transaction. */
	private readonly lifecycle: PrismaConversationParticipantLifecycleUnitOfWork;

	/** Connects each operation owner to the same database and release-selected creation resolver. */
	public constructor(prisma: PrismaClient, initialComputer: InitialConversationComputerResolver, companyAssistants: CompanyAssistantDirectory = async () => [])
	{
		this.directoryReader = new PrismaConversationDirectoryReader(prisma, companyAssistants);
		this.reader = new PrismaConversationMetadataReader(prisma);
		this.creation = new PrismaConversationCreationUnitOfWork(prisma, initialComputer, this.reader);
		this.lifecycle = new PrismaConversationParticipantLifecycleUnitOfWork(prisma);
	}

	/** Returns authorised creation choices for the current caller. */
	public directory(caller: ConversationCaller): Promise<unknown>
	{
		return this.directoryReader.directory(caller);
	}

	/** Lists the participant's currently readable conversation projections. */
	public list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationMetadataSummary[]>
	{
		return this.reader.list(caller, includeArchived);
	}

	/** Returns metadata for one conversation after its current read checks. */
	public open(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>
	{
		return this.reader.open(caller, conversationId);
	}

	/** Returns checked computer coordinates for a permitted review action. */
	public reviewCoordinates(caller: ConversationCaller, conversationId: string, action: ProductAuthorizationActions = ProductAuthorizationActions.Read): Promise<ConversationReviewCoordinates | null>
	{
		return this.reader.reviewCoordinates(caller, conversationId, action);
	}

	/** Creates or recovers the conversation fixed by the caller's retry key. */
	public create(caller: ConversationCaller, request: unknown): Promise<ConversationMetadataDetail | null>
	{
		return this.creation.create(caller, request);
	}

	/** Changes only this participant's archive choice. */
	public archive(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<ConversationMetadataDetail | null>
	{
		return this.lifecycle.archive(caller, conversationId, archived);
	}

	/** Permanently closes a conversation after its current delete admission. */
	public close(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>
	{
		return this.lifecycle.close(caller, conversationId);
	}
}
