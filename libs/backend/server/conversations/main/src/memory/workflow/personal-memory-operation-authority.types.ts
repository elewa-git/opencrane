import type { PersonalMemoryOperationEvent, PersonalMemoryOperationPersistenceResult, PersonalMemoryOperationRecord, PersonalMemoryOperationUnitOfWork } from "@opencrane/backend/agents/personal/memory";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { PersonalMemoryMessageSourceReader } from "../source/personal-memory-message-source.types";

/** Resolves the saved actor only while its principal and organisation membership remain current. */
export interface PersonalMemoryOperationActorResolver
{
	/**
	 * Resolves one exact personal-memory actor without accepting caller-selected identity data.
	 * @param siloId - Trusted silo saved with the operation.
	 * @param actorPrincipalId - Principal saved when the command was admitted.
	 * @returns Current external caller coordinates, or null after identity or membership loss.
	 */
	resolve(siloId: string, actorPrincipalId: string): Promise<ConversationCaller | null>;
}

/** Rechecks the operation's exact MemoryScope permission without creating or changing grants. */
export interface PersonalMemoryOperationAuthorization
{
	/**
	 * Decides the current action for the saved operation and its exact personal dataset.
	 * @param operation - Complete saved operation whose kind selects Manage or Forget.
	 * @param actor - Current external principal coordinates resolved from persistence.
	 * @param now - Trusted server time for grant validity.
	 * @returns Whether current product authorization still permits this operation.
	 */
	allows(operation: PersonalMemoryOperationRecord, actor: ConversationCaller, now: Date): Promise<boolean>;
}

/** In-process catalog transaction outcomes returned to the worker and not stored as wire state. */
export enum PersonalMemoryOperationAuthorizedCatalogApplyOutcomes
{
	/** Current actor, dataset, and MemoryScope authority passed before the event was applied. */
	Applied = "applied",
	/** Current membership or MemoryScope authority ended, so the transaction wrote no catalog state. */
	AuthorityEnded = "authority_ended",
	/** Current catalog coordinates conflict, so the transaction wrote recovery instead of catalog state. */
	CatalogConflict = "catalog_conflict",
}

/** Result of applying one catalog event with its current authority in the same transaction. */
export type PersonalMemoryOperationAuthorizedCatalogApplyResult =
	| { readonly outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.Applied; readonly persistence: PersonalMemoryOperationPersistenceResult }
	| { readonly outcome: PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.AuthorityEnded | PersonalMemoryOperationAuthorizedCatalogApplyOutcomes.CatalogConflict; readonly persistence: PersonalMemoryOperationPersistenceResult };

/** Applies catalog lifecycle events only while their current authority remains valid. */
export interface PersonalMemoryOperationCatalogUnitOfWork
{
	/**
	 * Rechecks actor, dataset, and MemoryScope evidence before applying the catalog event atomically.
	 * @param event - Catalog lifecycle event fenced to the saved operation revision.
	 * @param recordedAt - Trusted server time used by the lifecycle and catalog writes.
	 * @returns Persistence evidence plus whether current authority or catalog coordinates blocked the write.
	 */
	apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationAuthorizedCatalogApplyResult>;
}

/** Supplies deterministic time to saved lifecycle events. */
export interface PersonalMemoryOperationClock
{
	/** Returns the time recorded with the next accepted lifecycle event. */
	now(): Date;
}

/** Creates the stable UUID saved before a Cognify request can be sent. */
export interface PersonalMemoryOperationIdFactory
{
	/** Returns a fresh UUID for one indexing operation. */
	create(): string;
}

/** Dependencies held by the sole saved-phase personal-memory operation owner. */
export interface PersonalMemoryOperationAuthorityDependencies
{
	/** One configured silo accepted by this workflow registration. */
	readonly siloId: string;
	/** Loads saved operations and applies lifecycle events through revision compare-and-set. */
	readonly operations: PersonalMemoryOperationUnitOfWork;
	/** Applies catalog events with current actor and MemoryScope checks in one transaction. */
	readonly catalog: PersonalMemoryOperationCatalogUnitOfWork;
	/** Rechecks the admitted principal and its active organisation membership. */
	readonly actors: PersonalMemoryOperationActorResolver;
	/** Rechecks MemoryScope Manage or Forget before each provider or catalog effect. */
	readonly authorization: PersonalMemoryOperationAuthorization;
	/** Reads the exact admitted human message and keeps its plaintext transient. */
	readonly sources: PersonalMemoryMessageSourceReader;
	/** Executes one provider operation per method through the private memory gateway. */
	readonly gateway: MemoryGatewayClient;
	/** Supplies event timestamps without deriving them from saved provider evidence. */
	readonly clock: PersonalMemoryOperationClock;
	/** Creates an indexing UUID before the lifecycle saves it. */
	readonly ids: PersonalMemoryOperationIdFactory;
}
