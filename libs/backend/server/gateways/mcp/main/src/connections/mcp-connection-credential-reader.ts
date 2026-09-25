import { McpConnectionCredentialKinds } from "@opencrane/contracts";

import { McpConnectionCredentialReadOutcomes, type McpConnectionCredentialReadCommand, type McpConnectionCredentialReader, type McpConnectionCredentialReadResult } from "./mcp-connection-credential-reader.types";
import { McpConnectionSecretReadOutcomes, type McpConnectionAdmissionUnitOfWork, type McpConnectionCredentialSecretStore, type McpConnectionRecord, type McpConnectionSecretTarget } from "./mcp-connection.types";

/** Reads SQL coordinates before performing an exact ephemeral Secret read outside the transaction. */
export class __McpConnectionCredentialReader implements McpConnectionCredentialReader
{
	constructor(private readonly _unitOfWork: McpConnectionAdmissionUnitOfWork, private readonly _secrets: McpConnectionCredentialSecretStore) {}

	async readExact(command: McpConnectionCredentialReadCommand, signal?: AbortSignal): Promise<McpConnectionCredentialReadResult>
	{
		if (signal?.aborted)
			return { outcome: McpConnectionCredentialReadOutcomes.Uncertain };
		const record = await this._unitOfWork.execute(transaction => transaction.connections.readExecutionCredential(command));
		if (signal?.aborted)
			return { outcome: McpConnectionCredentialReadOutcomes.Uncertain };
		if (!record)
			return { outcome: McpConnectionCredentialReadOutcomes.NotFound };
		if (record.credentialKind === McpConnectionCredentialKinds.None)
			return _ReadCredentialless(record);
		if (record.credentialKind !== McpConnectionCredentialKinds.Bearer)
			return { outcome: McpConnectionCredentialReadOutcomes.Denied };
		const target = _SecretTarget(record);
		if (target === null)
			return { outcome: McpConnectionCredentialReadOutcomes.RecoveryRequired };
		const secret = await this._secrets.readExact(target, signal);
		if (secret.outcome === McpConnectionSecretReadOutcomes.Found)
			return { outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.Bearer, token: secret.bearerToken } };
		if (secret.outcome === McpConnectionSecretReadOutcomes.Uncertain)
			return { outcome: McpConnectionCredentialReadOutcomes.Uncertain };
		return { outcome: McpConnectionCredentialReadOutcomes.RecoveryRequired };
	}
}

function _ReadCredentialless(record: McpConnectionRecord): McpConnectionCredentialReadResult
{
	if (record.materialVerifier !== null || record.materialVerifierKeyId !== null || record.secretRef !== null || record.secretUid !== null || record.secretResourceVersion !== null)
		return { outcome: McpConnectionCredentialReadOutcomes.RecoveryRequired };
	return { outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.None } };
}

function _SecretTarget(record: McpConnectionRecord): McpConnectionSecretTarget | null
{
	if (!record.materialVerifier || !record.materialVerifierKeyId || !record.secretRef || !record.secretUid || !record.secretResourceVersion)
		return null;
	return {
		connectionId: record.id,
		siloId: record.siloId,
		ownerPrincipalId: record.ownerPrincipalId,
		generation: record.generation,
		endpointDigest: record.endpointDigest,
		materialVerifier: record.materialVerifier,
		materialVerifierKeyId: record.materialVerifierKeyId,
		expectedIdentity: { secretRef: record.secretRef, secretUid: record.secretUid, secretResourceVersion: record.secretResourceVersion },
	};
}
