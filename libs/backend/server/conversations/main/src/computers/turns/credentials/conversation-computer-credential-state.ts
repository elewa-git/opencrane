import type { ConversationComputerCredentialIssueCommand } from "../conversation-computer-turn.types";
import { ConversationComputerCredentialPreparationOutcomes, ConversationComputerCredentialStates, type ConversationComputerCredentialCustody, type ConversationComputerCredentialPreparation } from "../db/conversation-computer-credential-persistence.types";
import { _HasEncryptedCredentialCustody } from "./conversation-computer-credential-receipt";
import type { ConversationComputerCredentialStatePolicy } from "./conversation-computer-credential.types";

/**
 * Owns each persisted state's response to issuance, reuse and revocation. The repository supplies
 * already-bound rows and performs the resulting writes; this registry never performs I/O.
 */
const _STATES: Readonly<Record<ConversationComputerCredentialStates, ConversationComputerCredentialStatePolicy>> = {
	[ConversationComputerCredentialStates.Pending]: { prepare: _preparePending, reusable: false, requiresRevocation: _revokePending },
	[ConversationComputerCredentialStates.Custodied]: { prepare: _prepareCustodied, reusable: false, requiresRevocation: _revokeExisting },
	[ConversationComputerCredentialStates.Ready]: { prepare: _prepareReady, reusable: true, requiresRevocation: _revokeExisting },
	[ConversationComputerCredentialStates.AliasCleanup]: { prepare: _prepareAliasCleanup, reusable: false, requiresRevocation: _revokeExisting },
	[ConversationComputerCredentialStates.Revoking]: { prepare: _prepareRevoking, reusable: false, requiresRevocation: _revokeExisting },
	[ConversationComputerCredentialStates.Revoked]: { prepare: _refuseRevoked, reusable: false, requiresRevocation: _revokeFinished },
};

/** Selects recovery from an existing row; only a missing-row insert may authorize a provider mint. */
export function _PrepareExistingCredential(row: ConversationComputerCredentialCustody, input: ConversationComputerCredentialIssueCommand): ConversationComputerCredentialPreparation
{
	return _state(row).prepare(row, input);
}

/** Rejects every state except Ready and requires all encrypted fields before later receipt checks. */
export function _AssertCredentialReusable(row: ConversationComputerCredentialCustody): void
{
	if (!Object.hasOwn(_STATES, row.state) || !_STATES[row.state].reusable || !_HasEncryptedCredentialCustody(row))
		throw new Error("Conversation computer credential custody is not ready for reuse");
}

/** Refuses revocation of a live issue claim and makes completed cleanup a no-op. */
export function _CredentialRequiresRevocation(row: ConversationComputerCredentialCustody): boolean
{
	return _state(row).requiresRevocation(row);
}

/** Rejects unknown stored values rather than treating them as permission to issue or revoke. */
function _state(row: ConversationComputerCredentialCustody): ConversationComputerCredentialStatePolicy
{
	if (!Object.hasOwn(_STATES, row.state))
		throw new Error("Conversation computer credential has an unsupported custody state");
	return _STATES[row.state];
}

/** Waits for the original mint claim or requires alias cleanup after its deadline. */
function _preparePending(row: ConversationComputerCredentialCustody): ConversationComputerCredentialPreparation
{
	if (row.claimExpiresAt.getTime() <= Date.now())
		return _prepareAliasCleanup(row);
	if (row.claimExpiresAt.getTime() > Date.now())
		throw new Error("Conversation computer credential issuance is already in progress");
	throw new Error("Conversation computer credential has an unsupported custody state");
}

/** Requires promotion of the first committed key while its authority remains valid. */
function _prepareCustodied(row: ConversationComputerCredentialCustody, input: ConversationComputerCredentialIssueCommand): ConversationComputerCredentialPreparation
{
	return _prepareEncrypted(row, input, ConversationComputerCredentialPreparationOutcomes.Custody);
}

/** Returns the first ready key while its authority remains valid. */
function _prepareReady(row: ConversationComputerCredentialCustody, input: ConversationComputerCredentialIssueCommand): ConversationComputerCredentialPreparation
{
	return _prepareEncrypted(row, input, ConversationComputerCredentialPreparationOutcomes.Ready);
}

/** Requires complete ciphertext before deciding whether the existing key needs cleanup. */
function _prepareEncrypted(row: ConversationComputerCredentialCustody, input: ConversationComputerCredentialIssueCommand, outcome: ConversationComputerCredentialPreparationOutcomes.Custody | ConversationComputerCredentialPreparationOutcomes.Ready): ConversationComputerCredentialPreparation
{
	if (!_HasEncryptedCredentialCustody(row))
		throw new Error("Conversation computer credential is missing encrypted custody");
	if (row.expiresAt.getTime() <= Date.now() || row.expiresAt.getTime() > Date.parse(input.notAfter))
		return { outcome: ConversationComputerCredentialPreparationOutcomes.Expired, row };
	return { outcome, row };
}

/** Keeps an uncertain provider issue on the cleanup path without granting a replacement claim. */
function _prepareAliasCleanup(row: ConversationComputerCredentialCustody): ConversationComputerCredentialPreparation
{
	return { outcome: ConversationComputerCredentialPreparationOutcomes.AliasCleanup, row };
}

/** Continues cleanup rather than returning a key already claimed for revocation. */
function _prepareRevoking(row: ConversationComputerCredentialCustody): ConversationComputerCredentialPreparation
{
	return { outcome: ConversationComputerCredentialPreparationOutcomes.Expired, row };
}

/** Retains the spent attempt even after its secret fields have been cleared. */
function _refuseRevoked(): never
{
	throw new Error("Conversation computer credential attempt was already revoked");
}

/** Allows alias cleanup after a mint claim expires, but never races its live provider call. */
function _revokePending(row: ConversationComputerCredentialCustody): boolean
{
	if (row.claimExpiresAt.getTime() > Date.now())
		throw new Error("Conversation computer credential issuance is still in progress");
	return true;
}

/** Existing custody or incomplete cleanup still requires provider revocation. */
function _revokeExisting(): boolean
{
	return true;
}

/** A revoked attempt retains no provider cleanup work. */
function _revokeFinished(): boolean
{
	return false;
}
