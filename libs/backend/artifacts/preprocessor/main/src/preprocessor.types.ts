import type { ArtifactPreprocessorCompletionCommand, ArtifactPreprocessorJobClaim, ArtifactPreprocessorOutputLease, ArtifactPreprocessorOutputLeaseCommand } from "@opencrane/contracts";
import type { Logger } from "@opencrane/observability";

/** Minimal remote authority surface available to the isolated worker. */
export interface ArtifactPreprocessorRemote
{
	/** Claim the next eligible job, or return null when no work is ready. */
	claim(signal: AbortSignal): Promise<ArtifactPreprocessorJobClaim | null>;
	/** Read only the exact source bytes authorized by the claim's signed capability. */
	readSource(claim: ArtifactPreprocessorJobClaim, destinationPath: string, maximumBytes: number, signal: AbortSignal): Promise<void>;
	/** Ask OpenCrane to bind the hashed output to the still-live claim. */
	issueOutputLease(command: ArtifactPreprocessorOutputLeaseCommand, signal: AbortSignal): Promise<ArtifactPreprocessorOutputLease>;
	/** Promote exact derived bytes through the private ArtifactStore byte boundary. */
	promoteOutput(writeLease: string, output: Uint8Array, signal: AbortSignal): Promise<string>;
	/** Consume the artifact-service receipt while the claim still matches. */
	complete(command: ArtifactPreprocessorCompletionCommand, signal: AbortSignal): Promise<void>;
}

/** Configuration available to the remote authority and byte-boundary adapter. */
export interface ArtifactPreprocessorRemoteConfig
{
	/** Internal OpenCrane origin used for fenced job authority calls. */
	readonly openCraneInternalUrl: string;
	/** Private ArtifactStore origin used only with server-issued read and write capabilities. */
	readonly artifactServiceUrl: string;
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
	/** Remote capability-limited authority adapter. */
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
