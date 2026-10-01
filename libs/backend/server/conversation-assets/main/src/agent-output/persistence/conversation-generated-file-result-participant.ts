import type { ConversationToolExecutionAdmissionAuthority } from "@opencrane/backend/server/conversations";
import type { McpToolCallResult } from "@opencrane/contracts";

import { _ParseGeneratedFileResource } from "../generated-file-resource";
import { GeneratedFileResourceOutcomes } from "../generated-file-resource.types";
import { GeneratedFileCaptureError } from "./generated-file-capture-error";
import { GeneratedFileCaptureOutcomes } from "./generated-file-capture.types";
import { GeneratedFileCurrentExecutionAuthorityAdapter } from "./generated-file-current-execution-authority";
import type { GeneratedFileCaptureRepositoryFactory, GeneratedFileInvocationResultCommand } from "./generated-file-invocation-evidence.types";

/** Replaces governed file resources with capture metadata before the MCP owner saves terminal JSON. */
export class ConversationGeneratedFileResultParticipant
{
	/** Keep ordinary tool completion independent of the personal file feature's narrower authority. */
	constructor(private readonly createCapture: GeneratedFileCaptureRepositoryFactory, private readonly dispatch: ConversationToolExecutionAdmissionAuthority, private readonly scannerEnabled: boolean) {}

	/** Reject unowned resources, capture supported files, and preserve ordinary scalar or text results. */
	async prepare(command: GeneratedFileInvocationResultCommand): Promise<McpToolCallResult>
	{
		const parsed = _ParseGeneratedFileResource(command.toolName, command.invocation.effectiveArguments, command.result);
		if (command.remoteClaimFence !== undefined)
		{
			if (parsed.outcome !== GeneratedFileResourceOutcomes.NotApplicable)
				throw new GeneratedFileCaptureError("Remote MCP results cannot contain generated-file resources");
			return command.result;
		}
		if (parsed.outcome === GeneratedFileResourceOutcomes.NotApplicable)
			return command.result;
		if (parsed.outcome !== GeneratedFileResourceOutcomes.Accepted)
			throw new GeneratedFileCaptureError("Generated file result was rejected");

		if (!this.scannerEnabled)
			throw new GeneratedFileCaptureError("Generated file capture requires an enabled scanner");

		const currentExecution = new GeneratedFileCurrentExecutionAuthorityAdapter(command, this.dispatch);
		const capture = this.createCapture(currentExecution);
		const captured = await capture.capture(command);
		if (captured.outcome !== GeneratedFileCaptureOutcomes.Captured)
			throw new GeneratedFileCaptureError("Generated file capture did not return durable metadata");
		return captured.result;
	}
}
