import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { HostedGeneratedFilePublicClient } from "./hosted-generated-file-client";
import { __HostedGeneratedFileDigest, __SerializeHostedGeneratedFileEvidence } from "./hosted-generated-file-evidence";
import { __RunHostedGeneratedFileJourney } from "./hosted-generated-file-journey";
import { __PrepareHostedGeneratedFile } from "./hosted-generated-file-prerequisite-builder";
import { __LoadHostedGeneratedFilePrerequisites } from "./hosted-generated-file-prerequisites";
import { __CreateHostedGeneratedFileFetch } from "./hosted-generated-file-transport";
import { __VerifyHostedGeneratedFileJourney } from "./hosted-generated-file-verification";
import type { HostedGeneratedFileEvidence, HostedGeneratedFileQualificationConfig } from "./hosted-generated-file.types";

const _PREFIX = "OPENCRANE_HOSTED_QUALIFICATION_";

/** Validate the frozen fixture inputs before any public product write occurs. */
export async function __ValidateHostedGeneratedFileFixture(config: HostedGeneratedFileQualificationConfig): Promise<{ readonly archiveByteLength: number; readonly archiveContentAddress: string; readonly expectedCsvByteLength: number; readonly expectedCsvContentAddress: string }>
{
	await __LoadHostedGeneratedFilePrerequisites(config.prerequisitesPath);
	const [archive, expectedCsv] = await Promise.all([readFile(config.ociLayoutZipPath), readFile(config.expectedCsvPath)]);
	if (archive.byteLength === 0 || expectedCsv.byteLength === 0)
		throw new Error("Hosted qualification fixture files must contain bytes");
	return { archiveByteLength: archive.byteLength, archiveContentAddress: __HostedGeneratedFileDigest(archive), expectedCsvByteLength: expectedCsv.byteLength, expectedCsvContentAddress: __HostedGeneratedFileDigest(expectedCsv) };
}

/** Run the public journey and save only redacted restart coordinates. */
export async function __QualifyHostedGeneratedFile(config: HostedGeneratedFileQualificationConfig): Promise<void>
{
	await __ValidateHostedGeneratedFileFixture(config);
	const prerequisites = await __LoadHostedGeneratedFilePrerequisites(config.prerequisitesPath);
	await __RunHostedGeneratedFileJourney(config, prerequisites, __CreateHostedGeneratedFilePublicClient(config));
}

/** Parse the exact environment contract shared with the platform smoke orchestrator. */
export function __HostedGeneratedFileConfig(environment: NodeJS.ProcessEnv): HostedGeneratedFileQualificationConfig
{
	_RejectProviderInputs(environment);
	const baseUrl = _PublicBaseUrl(_Required(environment, "BASE_URL"));
	const transport = environment[`${_PREFIX}OIDC_TRANSPORT_BASE_URL`];
	const namespace = _Namespace(_Required(environment, "NAMESPACE"));
	const timeoutMilliseconds = Number(environment[`${_PREFIX}TIMEOUT_MS`] ?? "300000");
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1_000 || timeoutMilliseconds > 1_800_000)
		throw new Error(`${_PREFIX}TIMEOUT_MS must be an integer between 1000 and 1800000`);
	return {
		activationText: environment[`${_PREFIX}ACTIVATION_TEXT`] ?? "Create the deterministic qualification CSV file.",
		baseUrl,
		baseTransportAddress: _LoopbackAddress(_Required(environment, "BASE_TRANSPORT_ADDRESS")),
		databaseUrl: environment[`${_PREFIX}DATABASE_URL`] ?? null,
		evidencePath: _Required(environment, "EVIDENCE_PATH"),
		expectedCsvPath: _Required(environment, "EXPECTED_CSV_PATH"),
		expectedToolName: environment[`${_PREFIX}EXPECTED_TOOL_NAME`] ?? "opencrane_files_create_csv",
		ociLayoutZipPath: _Required(environment, "OCI_LAYOUT_ZIP_PATH"),
		namespace,
		oidcEmail: _Required(environment, "OIDC_EMAIL"),
		oidcIssuer: _HttpsUrl(_Required(environment, "OIDC_ISSUER"), "OIDC issuer").origin,
		oidcSubject: _Required(environment, "OIDC_SUBJECT"),
		oidcTransportBaseUrl: transport === undefined || transport === "" ? null : _HttpsUrl(transport, "OIDC transport"),
		ownerOidcEmail: _Required(environment, "OWNER_OIDC_EMAIL"),
		ownerOidcSubject: _Required(environment, "OWNER_OIDC_SUBJECT"),
		prerequisitesPath: _Required(environment, "PREREQUISITES_PATH"),
		providerApiBaseUrl: `http://hosted-generated-file-protocol.${namespace}.svc:4000/v1`,
		siloId: _Required(environment, "SILO_ID"),
		timeoutMilliseconds,
	};
}

/** Reject every former key or provider-URL input now that the fixture owns fixed public values. */
function _RejectProviderInputs(environment: NodeJS.ProcessEnv): void
{
	const forbidden = ["UPSTREAM_API_KEY", "UPSTREAM_API_KEY_PATH", "PROVIDER_API_BASE_URL", "PROVIDER_KEY_PATH"];
	if (forbidden.some(function _Present(suffix) { return environment[`${_PREFIX}${suffix}`] !== undefined; }) || environment["HOSTED_UPSTREAM_KEY_PATH"] !== undefined)
		throw new Error("Hosted qualification does not accept provider key or provider URL inputs");
}

/** Parse the disposable public origin before any authenticated session can mutate product state. */
function _PublicBaseUrl(value: string): URL
{
	const url = _HttpsUrl(value, "public server");
	const labels = url.hostname.split(".");
	if (url.port !== "8443" || labels.length < 3 || labels.slice(-2).join(".") !== "opencrane.test" || labels.some(function _InvalidLabel(label) { return !_IsDnsLabel(label); }))
		throw new Error(`${_PREFIX}BASE_URL must use a label-safe .opencrane.test hostname on explicit HTTPS port 8443`);
	return url;
}

/** Require public traffic to retain its qualified origin while connecting only to host loopback. */
function _LoopbackAddress(value: string): string
{
	if (value !== "127.0.0.1")
		throw new Error(`${_PREFIX}BASE_TRANSPORT_ADDRESS must be exactly 127.0.0.1`);
	return value;
}

/** Validate the runner-selected Kubernetes namespace as one lowercase DNS label. */
function _Namespace(value: string): string
{
	if (!_IsDnsLabel(value))
		throw new Error(`${_PREFIX}NAMESPACE must be one lowercase DNS label`);
	return value;
}

/** Return whether one value is a lowercase Kubernetes DNS label. */
function _IsDnsLabel(value: string): boolean
{
	return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value);
}

/** Keep the public client constructor reachable in the bundle without starting a second owner. */
export function __CreateHostedGeneratedFilePublicClient(config: HostedGeneratedFileQualificationConfig): HostedGeneratedFilePublicClient
{
	return new HostedGeneratedFilePublicClient(config.baseUrl, config.oidcTransportBaseUrl, __CreateHostedGeneratedFileFetch(config.baseUrl, config.baseTransportAddress), config.timeoutMilliseconds);
}

/** Write one complete redacted evidence file atomically through its caller-selected temporary path. */
export async function __WriteHostedGeneratedFileEvidence(path: string, evidence: HostedGeneratedFileEvidence): Promise<void>
{
	if (basename(path) === "" || !path.endsWith(".json"))
		throw new Error("Hosted qualification evidence path must name one JSON file");
	await writeFile(path, __SerializeHostedGeneratedFileEvidence(evidence), { encoding: "utf8", flag: "wx" });
}

/** Return one required, non-empty environment value. */
function _Required(environment: NodeJS.ProcessEnv, suffix: string): string
{
	const value = environment[`${_PREFIX}${suffix}`];
	if (value === undefined || value.trim() === "")
		throw new Error(`${_PREFIX}${suffix} is required`);
	return value;
}

/** Parse one HTTPS endpoint without embedded credentials or non-root path state. */
function _HttpsUrl(value: string, name: string): URL
{
	const url = new URL(value);
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "")
		throw new Error(`Hosted qualification ${name} must be a credentialless HTTPS origin`);
	return url;
}

/** Execute the command-line contract when this source is the process entrypoint. */
async function _Main(): Promise<void>
{
	const command = process.argv[2];
	const config = __HostedGeneratedFileConfig(process.env);
	if (command === "prepare")
	{
		const prerequisites = await __PrepareHostedGeneratedFile(config);
		process.stdout.write(`${JSON.stringify(prerequisites)}\n`);
		return;
	}
	if (command === "validate")
	{
		process.stdout.write(`${JSON.stringify(await __ValidateHostedGeneratedFileFixture(config))}\n`);
		return;
	}
	if (command === "qualify")
	{
		await __QualifyHostedGeneratedFile(config);
		process.stdout.write('{"status":"restart_ready"}\n');
		return;
	}
	if (command === "verify")
	{
		await __WriteHostedGeneratedFileEvidence(config.evidencePath, await __VerifyHostedGeneratedFileJourney(config));
		process.stdout.write('{"status":"verified"}\n');
		return;
	}
	throw new Error("Hosted qualification command must be prepare, validate, qualify, or verify");
}

const _EntrypointUrl = process.argv[1] === undefined ? null : new URL(`file://${process.argv[1]}`).href;
if (_EntrypointUrl === import.meta.url)
	void _Main().catch(function _Failure(error)
	{
		process.stderr.write(`${error instanceof Error ? error.message : "Hosted qualification failed"}\n`);
		process.exitCode = 1;
	});
