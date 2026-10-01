import { readFile } from "node:fs/promises";

import { __GrantHostedGeneratedFileAssign } from "./hosted-generated-file-assign-grant";
import { HostedGeneratedFilePublicClient } from "./hosted-generated-file-client";
import { __AssertHostedDownload, __AssertHostedOciContinuity, __HostedGeneratedFileDigest, __WriteHostedGeneratedFileCheckpoint } from "./hosted-generated-file-evidence";
import { __HostedGeneratedFileDelay as _Delay, __HostedGeneratedFileRemaining as _Remaining } from "./hosted-generated-file-timeout";
import type { HostedGeneratedFileAsset, HostedGeneratedFileInstalledTool, HostedGeneratedFileOciValidation, HostedGeneratedFilePrerequisites, HostedGeneratedFileQualificationConfig, HostedGeneratedFileRestartCheckpoint, HostedGeneratedFileRun, HostedGeneratedFileToolSelection } from "./hosted-generated-file.types";

/** Terminal public projections that must agree before the fixture permits restart. */
export interface HostedGeneratedFileTerminalProjection
{
	readonly finalPosition: string;
	readonly output: HostedGeneratedFileAsset;
	readonly run: HostedGeneratedFileRun;
}

/** Run the governed public journey through one activation and save restart coordinates. */
export async function __RunHostedGeneratedFileJourney(config: HostedGeneratedFileQualificationConfig, prerequisites: HostedGeneratedFilePrerequisites, client: HostedGeneratedFilePublicClient): Promise<HostedGeneratedFileRestartCheckpoint>
{
	if (prerequisites.expectedSiloId !== config.siloId)
		throw new Error("Hosted prerequisite silo differs from the configured deployment silo");
	await client.login({ subject: config.oidcSubject, email: config.oidcEmail });
	const conversationId = await client.createConversation(prerequisites.personalAgentRef);
	const archive = await readFile(config.ociLayoutZipPath);
	const upload = await client.uploadOciArchive(conversationId, "hosted-generated-file-producer.oci.zip", archive, __HostedGeneratedFileDigest(archive));
	const readyUpload = await _Poll(config.timeoutMilliseconds, async function _ReadyUpload(remainingMilliseconds)
	{
		return (await client.listAssets(conversationId, remainingMilliseconds)).find(function _Match(asset) { return asset.id === upload.id && asset.state === "ready"; }) ?? null;
	}, "OCI upload publication");
	let validation = await client.submitOciValidation(readyUpload);
	validation = await _Poll(config.timeoutMilliseconds, async function _Imported(remainingMilliseconds)
	{
		const current = await client.getOciValidation(validation.id, remainingMilliseconds);
		return current.state === "Imported" ? current : null;
	}, "OCI validation import");
	__AssertHostedOciContinuity(readyUpload, validation, archive);
	const promoted = await client.promoteOciValidation(validation.id, "Hosted generated-file producer");
	const discovered = await _Poll(config.timeoutMilliseconds, async function _Discovered(remainingMilliseconds) { return client.findServerTool(promoted.serverId, config.expectedToolName, remainingMilliseconds); }, "MCP tool discovery");
	if (discovered.serverRevisionId !== promoted.serverRevisionId)
		throw new Error("Hosted discovery changed the promoted server revision");
	await client.publishAndInstallServer(promoted.serverId);
	const installed: HostedGeneratedFileInstalledTool = { state: "discovered-published-installed", toolRevisionId: discovered.toolRevisionId };
	await _SelectTool(config, prerequisites, client, installed);
	const activation = await client.activate(conversationId, config.activationText);
	if (activation.outcome !== "accepted")
		throw new Error("Hosted activation did not create one new admission");
	const terminal = await _Poll(config.timeoutMilliseconds, async function _Terminal(remainingMilliseconds)
	{
		const [history, assets, runs] = await Promise.all([client.history(conversationId, remainingMilliseconds), client.listAssets(conversationId, remainingMilliseconds), client.listRuns(remainingMilliseconds)]);
		return _ReadTerminalProjection(history, assets, runs, conversationId);
	}, "generated-file terminal projections");
	const expectedCsv = await readFile(config.expectedCsvPath);
	const download = await client.download(conversationId, terminal.output.id);
	__AssertHostedDownload(download.bytes, expectedCsv, download.mediaType, download.cacheControl);
	const checkpoint = _Checkpoint(config, prerequisites, conversationId, activation, terminal, validation, readyUpload, promoted, discovered, expectedCsv);
	await __WriteHostedGeneratedFileCheckpoint(_CheckpointPath(config.evidencePath), checkpoint);
	return checkpoint;
}

/** Require the real personal selection owner to publish and commit exactly one successor. */
export function __AssertHostedToolSelection(before: HostedGeneratedFileToolSelection, selected: HostedGeneratedFileToolSelection, committed: HostedGeneratedFileToolSelection, personalAgentRef: string, toolRevisionId: string): void
{
	if (before.agentServiceId !== personalAgentRef || before.toolRevisionIds.length !== 0)
		throw new Error("Hosted personal tool selection did not start from the expected empty service");
	if (selected.agentServiceId !== personalAgentRef || selected.activeRevisionId === before.activeRevisionId || selected.toolRevisionIds.length !== 1 || selected.toolRevisionIds[0] !== toolRevisionId)
		throw new Error("Hosted personal tool selection did not publish the exact successor");
	if (committed.agentServiceId !== selected.agentServiceId || committed.activeRevisionId !== selected.activeRevisionId || committed.toolRevisionIds.length !== 1 || committed.toolRevisionIds[0] !== toolRevisionId)
		throw new Error("Hosted personal tool selection was not durably committed");
}

/** Read one completed run, assistant Artifact answer, and matching Ready output asset. */
export function _ReadTerminalProjection(history: Record<string, unknown>, assets: readonly HostedGeneratedFileAsset[], runs: readonly HostedGeneratedFileRun[], conversationId: string): HostedGeneratedFileTerminalProjection | null
{
	const entries = _Array(history["entries"]);
	const finalPosition = typeof history["nextPosition"] === "string" ? history["nextPosition"] : null;
	const completedRuns = runs.filter(function _Run(run) { return run.conversationId === conversationId && run.state === "completed" && run.finishedAt !== null; });
	if (completedRuns.length !== 1 || finalPosition === null)
		return null;
	const agentAnswers = entries.map(_Record).filter(function _Answer(entry)
	{
		return _Record(entry["author"])["kind"] === "agent" && entry["kind"] === "message" && entry["state"] === "completed" && entry["runId"] === completedRuns[0]!.runId;
	});
	if (agentAnswers.length !== 1 || !_Array(agentAnswers[0]!["blocks"]).some(function _Artifact(block) { return _Record(block)["kind"] === "artifact"; }))
		return null;
	const answer = agentAnswers[0]!;
	const artifact = _Array(answer["blocks"]).map(_Record).find(function _Artifact(block) { return block["kind"] === "artifact"; });
	if (artifact === undefined)
		return null;
	const outputs = assets.filter(function _Output(asset) { return asset.provenance === "agent_output" && asset.state === "ready" && asset.messageId === answer["id"] && asset.id === artifact["id"] && asset.artifactId === artifact["artifactId"] && asset.artifactRevisionId === artifact["artifactRevisionId"] && asset.displayName === artifact["name"] && asset.mediaType === artifact["mediaType"]; });
	return outputs.length === 1 ? { finalPosition, output: outputs[0]!, run: completedRuns[0]! } : null;
}

/** Return the restart checkpoint path derived from the caller-owned evidence path. */
export function _CheckpointPath(evidencePath: string): string
{
	return `${evidencePath}.restart-checkpoint.json`;
}

/** Add only the approved Assign prerequisite before strict public selection. */
async function _SelectTool(config: HostedGeneratedFileQualificationConfig, prerequisites: HostedGeneratedFilePrerequisites, client: HostedGeneratedFilePublicClient, installed: HostedGeneratedFileInstalledTool): Promise<void>
{
	if (config.databaseUrl === null || config.databaseUrl.trim() === "")
		throw new Error("OPENCRANE_HOSTED_QUALIFICATION_DATABASE_URL is required for the Assign prerequisite");
	const before = await client.getPersonalTools();
	if (before.agentServiceId !== prerequisites.personalAgentRef)
		throw new Error("Hosted personal tool GET resolved a different agent service");
	await __GrantHostedGeneratedFileAssign(config.databaseUrl, prerequisites, installed);
	const selected = await client.selectPersonalTool(before.activeRevisionId, installed.toolRevisionId);
	const committed = await client.getPersonalTools();
	__AssertHostedToolSelection(before, selected, committed, prerequisites.personalAgentRef, installed.toolRevisionId);
}

/** Build only stable public coordinates needed after restart. */
function _Checkpoint(config: HostedGeneratedFileQualificationConfig, prerequisites: HostedGeneratedFilePrerequisites, conversationId: string, activation: { readonly idempotencyKey: string; readonly outcome: string; readonly position: string }, terminal: HostedGeneratedFileTerminalProjection, validation: HostedGeneratedFileOciValidation, upload: HostedGeneratedFileAsset, promoted: { readonly serverId: string; readonly serverRevisionId: string }, discovered: { readonly toolRevisionId: string }, expectedCsv: Uint8Array): HostedGeneratedFileRestartCheckpoint
{
	return { schemaVersion: 1, conversationId, activationText: config.activationText, activationIdempotencyKey: activation.idempotencyKey, activationOutcome: activation.outcome, activationPosition: activation.position, expectedCsvContentAddress: __HostedGeneratedFileDigest(expectedCsv), expectedCsvByteLength: expectedCsv.byteLength, finalPosition: terminal.finalPosition, outputAssetId: terminal.output.id, outputArtifactId: terminal.output.artifactId!, outputArtifactRevisionId: terminal.output.artifactRevisionId!, outputDisplayName: terminal.output.displayName, outputMediaType: terminal.output.mediaType, uploadAssetId: upload.id, runId: terminal.run.runId, runAttempt: terminal.run.attempt, runAgentRevisionId: terminal.run.agentRevisionId, principalId: prerequisites.expectedPrincipalId, siloId: prerequisites.expectedSiloId, oci: { archiveByteLength: validation.byteLength, archiveContentAddress: validation.contentAddress, artifactId: upload.artifactId!, artifactRevisionId: upload.artifactRevisionId!, configDigest: validation.configDigest!, imageManifestDigest: validation.imageManifestDigest!, indexDigest: validation.indexDigest!, registryReference: validation.registryReference!, serverId: promoted.serverId, serverRevisionId: promoted.serverRevisionId, toolRevisionId: discovered.toolRevisionId, validationId: validation.id } };
}

/** Poll a read-only public projection until it reaches the expected terminal shape. */
async function _Poll<Value>(timeoutMilliseconds: number, read: (remainingMilliseconds: number) => Promise<Value | null>, operation: string): Promise<Value>
	{
		const deadline = Date.now() + timeoutMilliseconds;
		while (Date.now() < deadline)
		{
			const value = await read(_Remaining(deadline, operation));
			if (value !== null)
				return value;
			await _Delay(500, deadline, operation);
		}
		throw new Error(`Hosted ${operation} did not complete before timeout`);
	}

/** Narrow one response object. */
function _Record(value: unknown): Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Narrow one response array. */
function _Array(value: unknown): readonly unknown[]
{
	return Array.isArray(value) ? value : [];
}
