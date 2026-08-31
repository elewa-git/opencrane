import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";

/** The only way the worker reaches anything outside its process. Deliberately small: OpenCrane brokers both the source bytes and the output, so the worker holds no storage credential and needs no inbound network access. */
export interface ArtifactPreprocessorRemote
{
	/** Exchanges the Job-mounted reference for the assignment already claimed by the controller. */
	bootstrap(reference: string, signal: AbortSignal): Promise<ArtifactPreprocessorJobClaim>;
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

/** How the worker converts a PDF to text. In production this runs `pdftotext` with a fixed argument list and no shell, so a filename can never be interpreted as a command. */
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
	/** Structured process logger. */
	readonly logger: Logger;
}
