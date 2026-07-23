/** Fully validated configuration for the isolated PDF preprocessing process. */
export interface ArtifactPreprocessorProcessConfig
{
	/** Internal OpenCrane origin used for fenced job authority calls. */
	readonly openCraneInternalUrl: string;
	/** Private ArtifactStore origin used only with server-issued read and write capabilities. */
	readonly artifactServiceUrl: string;
	/** Absolute path to the rotating audience-bound Kubernetes ServiceAccount token. */
	readonly tokenPath: string;
	/** Directory backed by a bounded emptyDir for transient source and output files. */
	readonly scratchDirectory: string;
	/** Delay after an idle poll or handled job failure. */
	readonly pollIntervalMilliseconds: number;
	/** Hard timeout independently applied to each HTTP call. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum source PDF bytes the worker will stream into its scratch volume. */
	readonly maximumSourceBytes: number;
	/** Maximum UTF-8 text bytes the worker will accept from pdftotext. */
	readonly maximumOutputBytes: number;
	/** Wall-clock cap for one pdftotext child process. */
	readonly conversionTimeoutMilliseconds: number;
}
