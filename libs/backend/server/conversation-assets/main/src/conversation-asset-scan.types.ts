import type { GeneratedFileWorkflowRepository } from "./agent-output/persistence/workflow/generated-file-workflow-persistence.types";

/** Shares current authorization and terminal notification with the scanner's transaction. */
export type GeneratedFileScanAuthority = Pick<GeneratedFileWorkflowRepository, "loadCurrent" | "emitTerminal">;
