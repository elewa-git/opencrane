import { describe, expect, it } from "vitest";

import { __PrepareChildRunAdmission } from "../child-run-admission.js";
import type { ChildRunTargetAuthorization } from "../child-run-admission.types.js";

/** Parent facts with enough budget left to give a child. */
const _PARENT = { runId: "parent-1", siloId: "silo-1", rootRunId: "root-1", depth: 1, executionSubjectId: "user-1", remainingTokens: 1_000, remainingCostUsdMicros: 5_000_000, admittedChildCount: 1 } as const;
/** Server-owned recursive delegation bounds. */
const _LIMITS = { maximumDepth: 3, maximumChildrenPerParent: 4 } as const;
/** Target selected by a parent-authorized child-run tool policy. */
const _COMMAND = { childRunId: "child-1", targetAgentServiceId: "service-child", targetAgentRevisionId: "revision-child", requestedBudget: { maxTokens: 200, maxCostUsdMicros: 1_000_000 } } as const;
/** Policy double that permits the explicitly selected target. */
const _AUTHORIZED_TARGET: ChildRunTargetAuthorization = { authorize: async function _authorizeTarget() { return { outcome: "authorized" }; } };
/** Policy double that refuses the explicitly selected target. */
const _DENIED_TARGET: ChildRunTargetAuthorization = { authorize: async function _denyTarget() { return { outcome: "denied" }; } };
/** Policy double that cannot prove the target authorization. */
const _UNAVAILABLE_TARGET: ChildRunTargetAuthorization = { authorize: async function _failTarget() { throw new Error("authority source unavailable"); } };

describe("governed child run admission", function _describeChildRunAdmission()
{
	it("inherits lineage, silo, and subject only from parent authority while carving bounded budget", async function _preparesChild()
	{
		await expect(__PrepareChildRunAdmission(_PARENT, _COMMAND, _LIMITS, _AUTHORIZED_TARGET)).resolves.toEqual({ outcome: "prepared", value: { depth: 2, runId: "child-1", parentRunId: "parent-1", rootRunId: "root-1", siloId: "silo-1", executionSubjectId: "user-1", agentServiceId: "service-child", agentRevisionId: "revision-child", trigger: "managed_invocation", budget: { maxTokens: 200, maxCostUsdMicros: 1_000_000 } } });
	});

	it("denies a recursive fork at the configured depth cap", async function _deniesDepth()
	{
		await expect(__PrepareChildRunAdmission({ ..._PARENT, depth: 3 }, _COMMAND, _LIMITS, _AUTHORIZED_TARGET)).resolves.toEqual({ outcome: "denied", reason: "depth_exceeded" });
	});

	it("denies fan-out and budget reservations beyond the parent authority", async function _deniesFanoutAndBudget()
	{
		await expect(__PrepareChildRunAdmission({ ..._PARENT, admittedChildCount: 4 }, _COMMAND, _LIMITS, _AUTHORIZED_TARGET)).resolves.toEqual({ outcome: "denied", reason: "fanout_exceeded" });
		await expect(__PrepareChildRunAdmission(_PARENT, { ..._COMMAND, requestedBudget: { maxTokens: 1_001, maxCostUsdMicros: 1_000_000 } }, _LIMITS, _AUTHORIZED_TARGET)).resolves.toEqual({ outcome: "denied", reason: "budget_exceeded" });
	});

	it("denies malformed, unauthorised, and unavailable delegation authority", async function _deniesInvalidAuthorityAndTarget()
	{
		await expect(__PrepareChildRunAdmission({ ..._PARENT, executionSubjectId: "" }, _COMMAND, _LIMITS, _AUTHORIZED_TARGET)).resolves.toEqual({ outcome: "denied", reason: "invalid_parent_authority" });
		await expect(__PrepareChildRunAdmission(_PARENT, _COMMAND, _LIMITS, _DENIED_TARGET)).resolves.toEqual({ outcome: "denied", reason: "target_not_authorized" });
		await expect(__PrepareChildRunAdmission(_PARENT, _COMMAND, _LIMITS, _UNAVAILABLE_TARGET)).resolves.toEqual({ outcome: "denied", reason: "target_authorization_unavailable" });
	});
});
