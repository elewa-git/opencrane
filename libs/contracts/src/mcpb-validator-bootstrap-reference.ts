import { createHash } from "node:crypto";

/** Prefix that identifies an opaque reference projected into an MCP bundle validator Job. */
const _PREFIX = "mcpb-validator-v1_";

/** Build the stable opaque reference for one saved MCP bundle inspection workload. */
export function __CreateMcpbValidatorBootstrapReference(workloadId: string): string
{
	if (workloadId.length === 0 || workloadId.length > 256)
	{
		throw new Error("MCP bundle validator bootstrap reference requires one bounded workload id");
	}
	return `${_PREFIX}${createHash("sha256").update(workloadId).digest("hex")}`;
}

/** Return whether a value has the opaque MCP bundle validator reference shape. */
export function __IsMcpbValidatorBootstrapReference(value: unknown): value is string
{
	return typeof value === "string" && new RegExp(`^${_PREFIX}[a-f0-9]{64}$`, "u").test(value);
}
