/** Fully validated configuration for the isolated PDF preprocessing process. */
export interface ArtifactPreprocessorProcessConfig
{
	/** Internal OpenCrane origin this worker calls to claim and complete its fenced jobs. */
	readonly openCraneInternalUrl: string;
	/** Absolute path to the rotating audience-bound Kubernetes ServiceAccount token. */
	readonly tokenPath: string;
	/** Absolute path to the opaque assignment reference mounted into this Job. */
	readonly bootstrapReferencePath: string;
	/** Directory backed by a bounded emptyDir for transient source and output files. */
	readonly scratchDirectory: string;
	/** Hard timeout independently applied to each HTTP call. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum source PDF bytes the worker will stream into its scratch volume. */
	readonly maximumSourceBytes: number;
	/** Maximum UTF-8 text bytes the worker will accept from pdftotext. */
	readonly maximumOutputBytes: number;
	/** Wall-clock cap for one pdftotext child process. */
	readonly conversionTimeoutMilliseconds: number;
}
