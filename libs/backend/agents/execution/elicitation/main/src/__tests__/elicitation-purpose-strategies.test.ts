import { describe, expect, it, vi } from "vitest";

import { ElicitationBodyKinds, ElicitationPurposes } from "@opencrane/contracts";

import { _ElicitationPurposeStrategies } from "../elicitation-purpose-strategies";
import type { ElicitationPurposeStrategyDependencies } from "../elicitation-purpose-strategy.types";

/** Build transaction-bound operation spies for exhaustive dispatch assertions. */
function _Dependencies(): ElicitationPurposeStrategyDependencies
{
	return {
		applyRuntimeInput: vi.fn().mockResolvedValue(true),
		applyToolApproval: vi.fn().mockResolvedValue(true),
		applyPersonalMemoryPermission: vi.fn().mockResolvedValue(true),
		applyA2uiAction: vi.fn().mockResolvedValue(true),
		expireToolApproval: vi.fn().mockResolvedValue(undefined),
		expirePersonalMemoryPermission: vi.fn().mockResolvedValue(undefined),
		expireRuntimeDelivery: vi.fn().mockResolvedValue(undefined),
	};
}

describe("_ElicitationPurposeStrategies", function _DescribeElicitationPurposeStrategies()
{
	it("dispatches every durable purpose to its exact transaction-bound consequence", async function _DispatchesEveryPurpose()
	{
		const dependencies = _Dependencies();
		const strategies = new _ElicitationPurposeStrategies(dependencies);
		const request = { id: "request-1", runId: "run-1", attempt: 1, purposePayload: null, purposePayloadDigest: `sha256:${"a".repeat(64)}`, assignedParticipantId: "user-1", expiresAt: new Date("2026-08-12T12:15:00.000Z") };
		const response = { kind: ElicitationBodyKinds.Approval, approved: true } as const;
		const now = new Date("2026-08-12T12:00:00.000Z");

		await strategies.forPurpose(ElicitationPurposes.RuntimeInput).apply(request, response, "user-1", now);
		await strategies.forPurpose(ElicitationPurposes.ToolApproval).apply(request, response, "user-1", now);
		await strategies.forPurpose(ElicitationPurposes.PersonalMemoryPermission).apply(request, response, "user-1", now);
		await strategies.forPurpose(ElicitationPurposes.A2uiAction).apply(request, response, "user-1", now);
		await strategies.forPurpose(ElicitationPurposes.RuntimeInput).expire(request, now);
		await strategies.forPurpose(ElicitationPurposes.ToolApproval).expire(request, now);
		await strategies.forPurpose(ElicitationPurposes.PersonalMemoryPermission).expire(request, now);
		await strategies.forPurpose(ElicitationPurposes.A2uiAction).expire(request, now);

		expect(dependencies.applyRuntimeInput).toHaveBeenCalledOnce();
		expect(dependencies.applyToolApproval).toHaveBeenCalledOnce();
		expect(dependencies.applyPersonalMemoryPermission).toHaveBeenCalledOnce();
		expect(dependencies.applyA2uiAction).toHaveBeenCalledOnce();
		expect(dependencies.expireToolApproval).toHaveBeenCalledOnce();
		expect(dependencies.expirePersonalMemoryPermission).toHaveBeenCalledOnce();
		expect(dependencies.expireRuntimeDelivery).toHaveBeenCalledTimes(2);
	});

	it("fails closed for an unknown persisted purpose instead of falling back to runtime input", function _RejectsUnknownPurpose()
	{
		const strategies = new _ElicitationPurposeStrategies(_Dependencies());

		expect(function _UnknownPurpose() { strategies.forPurpose("future_protected_purpose" as ElicitationPurposes); }).toThrow(/unsupported elicitation purpose/);
	});
});
