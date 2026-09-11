/** Starts one conversation-computer child process. */
export type HostConversationComputerSpawn = (executable: string, argumentsList: string[], options: { readonly cwd: string; readonly detached: false; readonly env: NodeJS.ProcessEnv; readonly stdio: "inherit" }) => HostConversationComputerChild;

/** Retains the process methods needed for readiness and shutdown. */
export interface HostConversationComputerChild
{
	/** Sends a graceful or forced termination signal to the child. */
	kill(signal?: number | NodeJS.Signals): boolean;
	/** Observes successful operating-system process creation. */
	once(event: "spawn", listener: () => void): unknown;
	/** Observes a process creation or execution failure. */
	once(event: "error", listener: (error: Error) => void): unknown;
	/** Observes the child exit status. */
	once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	/** Stops observing a process failure. */
	removeListener(event: "error", listener: (error: Error) => void): unknown;
	/** Stops observing a child exit. */
	removeListener(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

/** Supplies replaceable operating-system effects to the host process owner. */
export interface HostConversationComputerProcessOwnerOptions
{
	/** Carries the loopback server endpoint available to every child. */
	readonly internalEndpoint: string;
	/** Supplies the app-owned executable contract without teaching this library another app's path. */
	readonly launch: HostConversationComputerLaunchSpecification;
	/** Replaces cryptographic random-byte generation in focused tests. */
	readonly randomBytes?: (size: number) => Buffer;
	/** Replaces child-process creation in focused tests. */
	readonly spawnProcess?: HostConversationComputerSpawn;
	/** Replaces private-directory removal in focused tests. */
	readonly removeDirectory?: (path: string, options: { readonly force: true; readonly recursive: true }) => Promise<void>;
	/** Supplies the parent environment without passing credential variables to children. */
	readonly environment?: NodeJS.ProcessEnv;
	/** Bounds each graceful and forced shutdown wait. */
	readonly shutdownGraceMilliseconds?: number;
}

/** Names the exact child entrypoint selected by the composing application. */
export interface HostConversationComputerLaunchSpecification
{
	/** Selects the executable resolved through the constrained child environment. */
	readonly executable: string;
	/** Carries fixed arguments owned by the composing application. */
	readonly arguments: readonly string[];
	/** Selects the app-owned working directory for the child. */
	readonly workingDirectory: string;
}

/** Carries the lease coordinates used to derive one stable process identifier. */
export interface HostConversationComputerProcessReservation
{
	/** Identifies the silo that owns the process. */
	readonly siloId: string;
	/** Identifies the logical conversation computer. */
	readonly computerId: string;
	/** Identifies the lease that owns this generation. */
	readonly leaseId: string;
	/** Fences the process to one conversation-computer generation. */
	readonly generation: number;
}

/** Carries non-secret coordinates that product history can persist before startup. */
export interface HostConversationComputerProcessCoordinates
{
	/** Identifies the operating-system child without carrying its private bearer. */
	readonly processId: string;
	/** Carries the loopback endpoint used by the child. */
	readonly endpoint: string;
}

/** Starts or observes the child reserved for one lease generation. */
export interface HostConversationComputerProcessClaimCommand extends HostConversationComputerProcessReservation
{
	/** Stops the child when this deadline arrives. */
	readonly expiresAt: string;
	/** Carries the process coordinates already recorded by the caller. */
	readonly coordinates: HostConversationComputerProcessCoordinates;
}

/** Selects one live child through its complete lease fence. */
export interface HostConversationComputerProcessCommand
{
	/** Identifies the logical conversation computer. */
	readonly computerId: string;
	/** Identifies the lease that owns the child. */
	readonly leaseId: string;
	/** Fences the child to one conversation-computer generation. */
	readonly generation: number;
	/** Carries the process coordinates recorded by the caller. */
	readonly coordinates: HostConversationComputerProcessCoordinates;
}

/** Moves the shutdown deadline for one live child. */
export interface HostConversationComputerProcessRenewCommand extends HostConversationComputerProcessCommand
{
	/** Replaces the current child shutdown deadline. */
	readonly expiresAt: string;
}

/** Reports the shutdown deadline applied to one live child. */
export interface HostConversationComputerProcessStatus
{
	/** Carries the deadline currently enforced by the process owner. */
	readonly shutdownTime: string;
}

/** Identifies a child after its private bearer has been authenticated. */
export interface HostConversationComputerProcessIdentity
{
	/** Identifies the child that owns the supplied bearer. */
	readonly processId: string;
}

/** Adds an authenticated process identity to an exact lease lookup. */
export interface HostConversationComputerProcessBindingCommand extends HostConversationComputerProcessCommand
{
	/** Carries the independently authenticated process identity. */
	readonly process: HostConversationComputerProcessIdentity;
}
