import { ConversationComputerRealizationKinds } from "@opencrane/contracts";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import type { ConversationComputerProcessIdentity } from "./conversation-computer-realization.types";

/** Return the reviewed Kubernetes identity only when the process is an Agent Sandbox. */
export function _ConversationComputerWorkloadIdentity(process: ConversationComputerProcessIdentity): RuntimeWorkloadIdentity | null
{
	switch (process.kind)
	{
		case ConversationComputerRealizationKinds.AgentSandbox:
			return process.workload;

		case ConversationComputerRealizationKinds.HostDevelopmentProcess:
			return null;

		default:
			return _UnreachableProcess(process);
	}
}

/** Makes a future process variant an explicit workload-narrowing decision. */
function _UnreachableProcess(_process: never): null
{
	return null;
}
