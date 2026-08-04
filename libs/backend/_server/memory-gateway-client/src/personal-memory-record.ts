import type { PersonalMemoryRecordResult } from "./memory-gateway-client.types.js";

/** Typed failure emitted when a gateway response cannot prove a valid durable personal-memory write. */
export class MemoryGatewayProtocolError extends Error
{
	/** Create an explicit protocol failure that callers must not reinterpret as an accepted fact. */
	constructor(message: string)
	{
		super(message);
		this.name = "MemoryGatewayProtocolError";
	}
}

/** Validate untrusted gateway JSON and return only explicit collision or canonical write evidence. */
export function __AssertPersonalMemoryRecordResult(value: unknown): PersonalMemoryRecordResult
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MemoryGatewayProtocolError("Memory gateway returned a non-object personal-memory record response");
	const result = value as Readonly<Record<string, unknown>>;
	if (result["outcome"] === "denied")
	{
		if (result["reason"] === "idempotency_conflict") return { outcome: "denied", reason: "idempotency_conflict" };
		throw new MemoryGatewayProtocolError("Memory gateway returned an unknown personal-memory record denial");
	}
	if (result["outcome"] !== "recorded" || typeof result["idempotent"] !== "boolean" || typeof result["cogneeExternalId"] !== "string" || typeof result["contentDigest"] !== "string" || !result["cogneeExternalId"].trim() || !/^sha256:[a-f0-9]{64}$/.test(result["contentDigest"])) throw new MemoryGatewayProtocolError("Memory gateway returned invalid personal-memory record evidence");
	return { outcome: "recorded", idempotent: result["idempotent"], cogneeExternalId: result["cogneeExternalId"], contentDigest: result["contentDigest"] };
}
