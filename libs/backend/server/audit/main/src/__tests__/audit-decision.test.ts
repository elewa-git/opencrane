import { describe, expect, it, vi } from "vitest";

import { __AppendAuditDecision } from "../audit-decision.js";

describe("target audit decision append port", function _suite()
{
	it("uses the driving domain transaction instead of creating an independent write", async function _append()
	{
		const create = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = { auditDecision: { create } };

		await __AppendAuditDecision(transaction as never, {
			decisionDigest: `sha256:${"1".repeat(64)}`,
			siloId: "silo-1",
			actorKind: "system",
			actorId: "opencrane",
			resourceKind: "agent-run",
			resourceId: "run-1",
			action: "retry",
			catalogId: "catalog-1",
			catalogRevision: 1,
			catalogDigest: `sha256:${"2".repeat(64)}`,
			argumentsDigest: `sha256:${"3".repeat(64)}`,
			policyRevisionHash: `sha256:${"4".repeat(64)}`,
			effectiveAuthorizationDigest: `sha256:${"5".repeat(64)}`,
			outcome: "allow",
			reasonCode: "authorized",
		});

		expect(create).toHaveBeenCalledOnce();
	});
});
