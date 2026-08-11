import type { ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand, ArtifactScannerVerdict } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";

/** OpenCrane broker surface available to the isolated scanner. */
export interface ArtifactScannerRemote
{
	/** Claim one eligible quarantined revision. */
	claim(signal: AbortSignal): Promise<ArtifactScannerJobClaim | null>;
	/** Stream the exact claimed bytes to a new local scratch file. */
	readSource(claim: ArtifactScannerJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>;
	/** Submit a clean or rejected verdict through the live claim fence. */
	reportResult(command: ArtifactScannerResultCommand, signal: AbortSignal): Promise<void>;
	/** Submit a stable worker failure through the live claim fence. */
	reportFailure(command: ArtifactScannerFailureCommand, signal: AbortSignal): Promise<void>;
}

/** Configuration for the projected-token OpenCrane adapter. */
export interface ArtifactScannerRemoteConfig
{
	/** Credential-free cluster-local OpenCrane origin. */
	readonly openCraneInternalUrl: string;
	/** Absolute rotating projected-token path. */
	readonly tokenPath: string;
	/** Per-request deadline. */
	readonly requestTimeoutMilliseconds: number;
}

/** Shell-free local malware engine. */
export interface ArtifactMalwareScanner
{
	/** Scan the complete local file and return only a public verdict. */
	scan(sourcePath: string, timeoutMilliseconds: number, signal: AbortSignal): Promise<ArtifactScannerVerdict>;
	/** Pinned engine/definition version reported with every verdict. */
	readonly version: string;
}

/** Dependencies for the scanner polling loop. */
export interface ArtifactScannerDependencies
{
	/** Server-owned job and byte broker. */
	readonly remote: ArtifactScannerRemote;
	/** Local pinned malware engine. */
	readonly scanner: ArtifactMalwareScanner;
	/** Bounded ephemeral scratch directory. */
	readonly scratchDirectory: string;
	/** Maximum accepted source bytes. */
	readonly maximumSourceBytes: number;
	/** Maximum local scan duration. */
	readonly scanTimeoutMilliseconds: number;
	/** Idle or handled-error delay. */
	readonly pollIntervalMilliseconds: number;
	/** Structured process logger. */
	readonly logger: Logger;
}
