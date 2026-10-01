import { readFile } from "node:fs/promises";

import { __AssertHostedDownload, __AssertHostedOciContinuity, __HostedGeneratedFileDigest, __LoadHostedGeneratedFileCheckpoint } from "./hosted-generated-file-evidence";
import { _CheckpointPath, _ReadTerminalProjection } from "./hosted-generated-file-journey";
import { __CreateHostedGeneratedFileSession } from "./hosted-generated-file-prerequisite-builder";
import type { HostedGeneratedFileEvidence, HostedGeneratedFileOciValidation, HostedGeneratedFileQualificationConfig, HostedGeneratedFileRestartCheckpoint, HostedGeneratedFileRun, HostedGeneratedFileToolSelection } from "./hosted-generated-file.types";

/** Verify restart persistence, idempotent replay, and real membership revocation. */
export async function __VerifyHostedGeneratedFileJourney(config: HostedGeneratedFileQualificationConfig): Promise<HostedGeneratedFileEvidence>
{
	const checkpoint = await __LoadHostedGeneratedFileCheckpoint(_CheckpointPath(config.evidencePath));
	if (checkpoint.siloId !== config.siloId || checkpoint.activationText !== config.activationText)
		throw new Error("Hosted restart inputs differ from the admitted qualification");
	const requester = __CreateHostedGeneratedFileSession(config);
	await requester.login({ subject: config.oidcSubject, email: config.oidcEmail });
	const replay = await requester.replaySavedActivation(checkpoint.conversationId, checkpoint.activationText, checkpoint.activationIdempotencyKey, checkpoint.activationPosition);
	const validation = await requester.getOciValidation(checkpoint.oci.validationId);
	_AssertRestartedOci(validation, checkpoint);
	const discovered = await requester.findServerTool(checkpoint.oci.serverId, config.expectedToolName);
	if (discovered === null || discovered.serverRevisionId !== checkpoint.oci.serverRevisionId || discovered.toolRevisionId !== checkpoint.oci.toolRevisionId)
		throw new Error("Hosted MCP discovery coordinates changed across restart");
	_AssertRestartedSelection(await requester.getPersonalTools(), checkpoint);
	const runs = await requester.listRuns();
	const matchingRuns = runs.filter(function _ConversationRun(run) { return run.conversationId === checkpoint.conversationId; });
	if (matchingRuns.length !== 1)
		throw new Error("Hosted public run list changed its conversation cardinality across restart");
	_AssertRestartedRun(matchingRuns[0]!, checkpoint);
	const run = await requester.getRun(checkpoint.runId);
	_AssertRestartedRun(run, checkpoint);
	const history = await requester.history(checkpoint.conversationId);
	const assets = await requester.listAssets(checkpoint.conversationId);
	const upload = assets.find(function _Upload(asset) { return asset.id === checkpoint.uploadAssetId; });
	const archive = await readFile(config.ociLayoutZipPath);
	if (upload === undefined || archive.byteLength !== checkpoint.oci.archiveByteLength || __HostedGeneratedFileDigest(archive) !== checkpoint.oci.archiveContentAddress)
		throw new Error("Hosted OCI archive or upload coordinate changed across restart");
	__AssertHostedOciContinuity(upload, validation, archive);
	const terminal = _ReadTerminalProjection(history, assets, matchingRuns, checkpoint.conversationId);
	if (terminal === null || terminal.finalPosition !== checkpoint.finalPosition || terminal.run.runId !== checkpoint.runId || terminal.run.attempt !== checkpoint.runAttempt || terminal.run.agentRevisionId !== checkpoint.runAgentRevisionId || terminal.output.id !== checkpoint.outputAssetId || terminal.output.artifactId !== checkpoint.outputArtifactId || terminal.output.artifactRevisionId !== checkpoint.outputArtifactRevisionId || terminal.output.displayName !== checkpoint.outputDisplayName || terminal.output.mediaType !== checkpoint.outputMediaType)
		throw new Error("Hosted public projections changed across restart or replay");
	const expectedCsv = await readFile(config.expectedCsvPath);
	if (__HostedGeneratedFileDigest(expectedCsv) !== checkpoint.expectedCsvContentAddress || expectedCsv.byteLength !== checkpoint.expectedCsvByteLength)
		throw new Error("Hosted expected CSV fixture changed between qualification phases");
	const download = await requester.download(checkpoint.conversationId, checkpoint.outputAssetId);
	__AssertHostedDownload(download.bytes, expectedCsv, download.mediaType, download.cacheControl);

	const owner = __CreateHostedGeneratedFileSession(config);
	await owner.login({ subject: config.ownerOidcSubject, email: config.ownerOidcEmail });
	const membershipId = await owner.membershipIdForEmail(config.oidcEmail);
	await owner.removeMember(membershipId);
	const deniedPaths = [`/api/v1/me/conversations/${encodeURIComponent(checkpoint.conversationId)}/history`, `/api/v1/me/conversations/${encodeURIComponent(checkpoint.conversationId)}/assets`, "/api/v1/me/runs", `/api/v1/me/runs/${encodeURIComponent(checkpoint.runId)}`];
	await requester.assertMembershipDenied(deniedPaths);
	await requester.assertDownloadDenied(checkpoint.conversationId, checkpoint.outputAssetId);
	const freshRequester = __CreateHostedGeneratedFileSession(config);
	await freshRequester.login({ subject: config.oidcSubject, email: config.oidcEmail });
	await freshRequester.assertMembershipDenied([deniedPaths[0]!]);

	return {
		schemaVersion: 1,
		activation: { idempotencyKey: checkpoint.activationIdempotencyKey, firstOutcome: checkpoint.activationOutcome, replayOutcome: replay.outcome, position: checkpoint.activationPosition },
		conversation: { id: checkpoint.conversationId, finalPosition: checkpoint.finalPosition, answerCount: 1, runId: checkpoint.runId, runAttempt: checkpoint.runAttempt, runAgentRevisionId: checkpoint.runAgentRevisionId, outputAssetId: checkpoint.outputAssetId, outputArtifactId: checkpoint.outputArtifactId, outputArtifactRevisionId: checkpoint.outputArtifactRevisionId, outputDisplayName: checkpoint.outputDisplayName },
		download: { byteLength: download.bytes.byteLength, contentAddress: __HostedGeneratedFileDigest(download.bytes), mediaType: download.mediaType!, cacheControl: download.cacheControl! },
		identity: { principalId: checkpoint.principalId, siloId: checkpoint.siloId },
		oci: checkpoint.oci,
	};
}

/** Require the public validation to preserve every admitted OCI and registry coordinate. */
function _AssertRestartedOci(validation: HostedGeneratedFileOciValidation, checkpoint: HostedGeneratedFileRestartCheckpoint): void
{
	const expected = checkpoint.oci;
	if (validation.id !== expected.validationId || validation.state !== "Imported" || validation.artifactId !== expected.artifactId || validation.artifactRevisionId !== expected.artifactRevisionId || validation.byteLength !== expected.archiveByteLength || validation.contentAddress !== expected.archiveContentAddress || validation.configDigest !== expected.configDigest || validation.imageManifestDigest !== expected.imageManifestDigest || validation.indexDigest !== expected.indexDigest || validation.registryReference !== expected.registryReference)
		throw new Error("Hosted OCI validation coordinates changed across restart");
}

/** Require the restarted personal owner to keep the exact selected tool and admitted revision. */
function _AssertRestartedSelection(selection: HostedGeneratedFileToolSelection, checkpoint: HostedGeneratedFileRestartCheckpoint): void
{
	if (selection.activeRevisionId !== checkpoint.runAgentRevisionId || selection.toolRevisionIds.length !== 1 || selection.toolRevisionIds[0] !== checkpoint.oci.toolRevisionId)
		throw new Error("Hosted personal tool selection changed across restart");
}

/** Require list and item projections to retain the exact admitted run snapshot. */
function _AssertRestartedRun(run: HostedGeneratedFileRun, checkpoint: HostedGeneratedFileRestartCheckpoint): void
{
	if (run.runId !== checkpoint.runId || run.attempt !== checkpoint.runAttempt || run.state !== "completed" || run.conversationId !== checkpoint.conversationId || run.agentRevisionId !== checkpoint.runAgentRevisionId || run.finishedAt === null)
		throw new Error("Hosted run coordinates changed across restart");
}
