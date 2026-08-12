/** Validated scanner process configuration. */
export interface ArtifactScannerProcessConfig
{
	/** Internal OpenCrane broker origin. */
	readonly openCraneInternalUrl: string;
	/** Rotating audience-bound token path. */
	readonly tokenPath: string;
	/** Bounded emptyDir scratch path. */
	readonly scratchDirectory: string;
	/** Offline clamscan executable path. */
	readonly executablePath: string;
	/** Read-only pinned definition database path. */
	readonly databasePath: string;
	/** Public pinned scanner version. */
	readonly scannerVersion: string;
	/** Idle retry delay. */
	readonly pollIntervalMilliseconds: number;
	/** Per-request deadline. */
	readonly requestTimeoutMilliseconds: number;
	/** Maximum accepted source bytes. */
	readonly maximumSourceBytes: number;
	/** Maximum scan duration. */
	readonly scanTimeoutMilliseconds: number;
}
