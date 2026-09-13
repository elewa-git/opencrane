import { MemoryGatewayErrorCodes } from "@opencrane/contracts";

import type { CogneeProviderSession } from "../auth/cognee-provider-session.types";
import type { CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";
import { _CogneePipelineRunWireSchema } from "./cognee-provider-wire.validator";
import type { CogneePipelineRunWire } from "./cognee-provider-wire.types";
import { _CanonicalProviderUuid, _ParseProviderValue, _PreDispatchMutationFailure, _ReadErrorForStatus, _ReadFailure } from "./cognee-provider-operation-support";
import { MemoryGatewayProviderReadError } from "./memory-gateway-provider-error";

/** Send a read request and remove provider details from every failure. */
export async function _ReadExchange(session: CogneeProviderSession, command: CogneeProviderHttpCommand): Promise<CogneeProviderHttpResponse>
{
	try
	{
		return await session.exchange(command);
	}
	catch (error)
	{
		throw _ReadFailure(error);
	}
}

/** Require a provider read to return HTTP 200. */
export function _ReadSuccess(response: CogneeProviderHttpResponse): void
{
	if (response.status !== 200)
		throw _ReadErrorForStatus(response.status);
}

/** Prove authentication before mutation bytes can be sent. */
export async function _PrepareMutation(session: CogneeProviderSession): Promise<void>
{
	try
	{
		await session.ensureReady();
	}
	catch (error)
	{
		throw _PreDispatchMutationFailure(error);
	}
}

/** Require a completed pipeline receipt for the saved dataset, operation, and input digest. */
export function _CompletedPipeline(value: unknown, datasetId: string, operationId: string, inputEvidenceDigest: string): CogneePipelineRunWire
{
	const run = _ParseProviderValue(_CogneePipelineRunWireSchema, value);
	const coordinatesMatch = _CanonicalProviderUuid(run.dataset_id) === _CanonicalProviderUuid(datasetId)
		&& _CanonicalProviderUuid(run.operation_id) === _CanonicalProviderUuid(operationId)
		&& run.input_evidence_digest === inputEvidenceDigest;
	if (!coordinatesMatch)
		throw new MemoryGatewayProviderReadError(MemoryGatewayErrorCodes.ProviderProtocol);
	return run;
}
