import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import type { Logger } from "@opencrane/observability";

/** Minimal OpenCrane broker surface available to the isolated worker. */
export interface ArtifactPreprocessorRemote
{
	/** Claim the next eligible job, or return null when no work is ready. */
	claim(signal: AbortSignal): Promise<ArtifactPreprocessorJobClaim | null>;
	/** Ask OpenCrane to stream the exact source bytes authorized by the live claim. */
	readSource(claim: ArtifactPreprocessorJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>;
	/** Stream one bounded text output to OpenCrane for server-owned hashing, storage, and publication. */
	submitOutput(command: ArtifactPreprocessorClaimCommand, sourcePath: string, byteLength: number, signal: AbortSignal): Promise<void>;
	/** Report one bounded failure category so the server can apply its durable retry policy. */
	reportFailure(command: ArtifactPreprocessorFailureCommand, signal: AbortSignal): Promise<void>;
}

/** Configuration available to the OpenCrane-only remote adapter. */
export interface ArtifactPreprocessorRemoteConfig
{
	/** Internal OpenCrane origin used for all fenced job and byte-broker calls. */
	readonly openCraneInternalUrl: string;
	/** Absolute path to the rotating audience-bound Kubernetes ServiceAccount token. */
	readonly tokenPath: string;
	/** Hard timeout independently applied to each HTTP call and response body. */
	readonly requestTimeoutMilliseconds: number;
}

/** Isolated deterministic conversion port; production invokes pdftotext without a shell. */
export interface PdfTextExtractor
{
	/** Convert one source PDF path to an output UTF-8 file under the provided wall-clock cap. */
	extract(sourcePath: string, outputPath: string, timeoutMilliseconds: number, signal: AbortSignal): Promise<void>;
}

/** Runtime dependencies for one durable PDF preprocessing worker loop. */
export interface ArtifactPreprocessorDependencies
{
	/** Remote OpenCrane byte-broker and job-authority adapter. */
	readonly remote: ArtifactPreprocessorRemote;
	/** Shell-free PDF text conversion adapter. */
	readonly extractor: PdfTextExtractor;
	/** Bounded scratch directory mounted exclusively for transient files. */
	readonly scratchDirectory: string;
	/** Maximum accepted source PDF bytes. */
	readonly maximumSourceBytes: number;
	/** Maximum accepted UTF-8 output bytes. */
	readonly maximumOutputBytes: number;
	/** Maximum duration for pdftotext. */
	readonly conversionTimeoutMilliseconds: number;
	/** Idle or handled-error backoff. */
	readonly pollIntervalMilliseconds: number;
	/** Structured process logger. */
	readonly logger: Logger;
}
