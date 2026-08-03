import { Prisma, type PrismaClient } from "@prisma/client";

import type { ProductionExternalActionPorts } from "@opencrane/backend/agents/execution/protocol";
import { __CreateHttpCogneeMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { PersonalMemoryDeliveryKey, PersonalMemoryDeliveryLedger, PersonalMemoryDeliveryRecord } from "@opencrane/server/_infra/memory-gateway-client";
import { __CreateHttpObotMcpInvocationAdapter } from "@opencrane/server/_infra/obot-custody";

import type { InternalRuntimeConfig } from "../../app/config.types.js";

/** Prisma error code raised when a write violates a unique constraint. */
const _UNIQUE_VIOLATION = "P2002";

/**
 * Durable delivery ledger giving the stateless Cognee API idempotent personal-memory writes.
 *
 * The unique constraint on the delivery coordinates is the concurrency authority: a losing writer
 * learns it lost from the database rather than from a read that could race.
 */
export class PrismaPersonalMemoryDeliveryLedger implements PersonalMemoryDeliveryLedger
{
	/** Canonical product-authority persistence client. */
	private readonly prisma: PrismaClient;

	/** Bind the ledger to the process-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Return the durable evidence recorded for a delivery key, or null when it is unused. */
	async findDelivery(key: PersonalMemoryDeliveryKey): Promise<PersonalMemoryDeliveryRecord | null>
	{
		const row = await this.prisma.memoryDeliveryLedger.findUnique({
			where: { siloId_cogneeDatasetId_subjectId_idempotencyKey: { siloId: key.siloId, cogneeDatasetId: key.cogneeDatasetId, subjectId: key.subjectId, idempotencyKey: key.idempotencyKey } },
			select: { contentDigest: true, cogneeExternalId: true },
		});
		return row === null ? null : { contentDigest: row.contentDigest, cogneeExternalId: row.cogneeExternalId };
	}

	/** Persist evidence for a fresh delivery, reporting a concurrent writer instead of overwriting. */
	async recordDelivery(key: PersonalMemoryDeliveryKey, record: PersonalMemoryDeliveryRecord): Promise<"recorded" | "conflict_existing">
	{
		try
		{
			await this.prisma.memoryDeliveryLedger.create({ data: { siloId: key.siloId, cogneeDatasetId: key.cogneeDatasetId, subjectId: key.subjectId, idempotencyKey: key.idempotencyKey, contentDigest: record.contentDigest, cogneeExternalId: record.cogneeExternalId } });
			return "recorded";
		}
		catch (error)
		{
			// Only the unique violation means "someone else owns this key"; anything else is a real
			// persistence failure the caller must see.
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === _UNIQUE_VIOLATION) return "conflict_existing";
			throw error;
		}
	}

	/** Resolve which dataset holds a gateway-minted fact for a subject, or null when unknown. */
	async resolveFactDataset(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string }): Promise<{ readonly cogneeDatasetId: string } | null>
	{
		const row = await this.prisma.memoryDeliveryLedger.findFirst({
			where: { siloId: reference.siloId, subjectId: reference.subjectId, cogneeExternalId: reference.factId },
			select: { cogneeDatasetId: true },
		});
		return row === null ? null : { cogneeDatasetId: row.cogneeDatasetId };
	}

	/** Replace a corrected fact's remote identity only when the prior identity is still current. */
	async replaceFactReference(reference: { readonly siloId: string; readonly subjectId: string; readonly factId: string; readonly replacementFactId: string }): Promise<"replaced" | "missing">
	{
		const updated = await this.prisma.memoryDeliveryLedger.updateMany({
			where: { siloId: reference.siloId, subjectId: reference.subjectId, cogneeExternalId: reference.factId },
			data: { cogneeExternalId: reference.replacementFactId },
		});
		return updated.count === 1 ? "replaced" : "missing";
	}
}

/**
 * Build the configured outbound external-action transports for the dispatch authority.
 *
 * A transport is constructed ONLY when its gateway URL is configured; an omitted URL leaves the port
 * undefined so the dispatch factory keeps its fail-closed stub. A malformed URL throws here, at
 * startup, rather than turning every later tool call into a retryable dispatch failure.
 *
 * @param prisma - Canonical product-authority persistence client backing the delivery ledger.
 * @param config - Internal runtime configuration carrying the gateway origins and timeout.
 * @returns The ports to inject; each absent entry preserves the fail-closed default.
 */
export function _CreateExternalActionPorts(prisma: PrismaClient, config: InternalRuntimeConfig): ProductionExternalActionPorts
{
	const requestTimeoutMilliseconds = config.externalActionHttpTimeoutMilliseconds;
	return {
		...(config.obotMcpGatewayUrl === null ? {} : { obotMcpInvocation: __CreateHttpObotMcpInvocationAdapter({ baseUrl: config.obotMcpGatewayUrl, requestTimeoutMilliseconds }) }),
		...(config.memoryGatewayUrl === null || config.memoryGatewayTokenFile === null ? {} : { memoryGateway: __CreateHttpCogneeMemoryGatewayClient({ baseUrl: config.memoryGatewayUrl, requestTimeoutMilliseconds, ledger: new PrismaPersonalMemoryDeliveryLedger(prisma), serverTokenFile: config.memoryGatewayTokenFile }) }),
	};
}
