import { describe, expect, it } from "vitest";

import { ConversationComputerRealizationKinds } from "@opencrane/contracts";

import { _ConversationComputerWorkloadIdentity } from "../conversation-computer-realization";

describe("conversation computer process identity", function _ConversationComputerProcessIdentitySuite()
{
	it("returns a workload only for an Agent Sandbox process", function _AgentSandboxProcess()
	{
		const workload = {
			subject: "system:serviceaccount:computers:computer",
			namespace: "computers",
			serviceAccountName: "computer",
			podUid: "pod-1",
		};
		expect(_ConversationComputerWorkloadIdentity({ kind: ConversationComputerRealizationKinds.AgentSandbox, workload })).toBe(workload);
	});

	it("does not manufacture a Kubernetes workload for a host process", function _HostProcess()
	{
		expect(_ConversationComputerWorkloadIdentity({ kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: "process-1" })).toBeNull();
	});
});
