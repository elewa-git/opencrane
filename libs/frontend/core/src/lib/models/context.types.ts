import { ResourceBoundaryKind } from "./boundary.types";

/** A boundary dataset row in the context panel's retrieved-context rail. */
export interface ScopeContextEntry
{
	/** Stable Principal or Group ID that owns the boundary. */
	boundaryId: string;
	/** Stored boundary discriminator; group hierarchy remains separate data. */
	boundaryKind: ResourceBoundaryKind;
	/** Dataset label (e.g. "acme-corp"). */
	label: string;
	/** Secondary description line. */
	sublabel: string;
	/** Whether the dataset is active for this session. */
	active: boolean;
	/** Freshness indicator (e.g. "4m ago", "live"). */
	freshness: string;
	/** Citations contributed to the current thread. */
	citationCount: number;
	/** Boundary accent colour. */
	color: string;
}

/** A retrieved citation snippet shown under an expanded scope. */
export interface ScopeCitation
{
	/** Stable citation id. */
	id: string;
	/** Stable boundary that supplied the citation. */
	boundaryId: string;
	/** Stored boundary discriminator. */
	boundaryKind: ResourceBoundaryKind;
	/** Source identifier (file, channel, wiki). */
	source: string;
	/** Cited snippet text. */
	snippet: string;
	/** Freshness indicator. */
	freshness: string;
}

/** An active skill row in the context panel. */
export interface ActiveSkill
{
	/** Skill name. */
	name: string;
	/** Boundary kind at which the skill is granted. */
	boundaryKind: ResourceBoundaryKind;
	/** Skill version string ("local" for unpublished). */
	version: string;
	/** Whether the skill is active. */
	active: boolean;
}

/** A ledger trace entry in the context panel's Ledger tab. */
export interface LedgerEntry
{
	/** Entry id (e.g. "R1", "P1", "A1"). */
	id: string;
	/** Entry kind ("observation" | "policy" | "action"). */
	type: string;
	/** Resource boundary kind of the entry. */
	boundaryKind: ResourceBoundaryKind;
	/** Entry label. */
	label: string;
	/** Source reference. */
	ref: string;
	/** Entry status, or null when open. */
	status: string | null;
}

/** Whether a canvas document is still a draft or is the published version for its scope. */
export enum CanvasDocumentLifecycles
{
	/** An editable document that has not become the published reference. */
	Draft = "draft",
	/** A reviewed document that is the published reference for its scope. */
	Published = "published"
}

/** How a save is going. The renderer only displays this; it never sets it itself. */
export enum CanvasDocumentSaveStates
{
	/** No save request is in flight. */
	Idle = "idle",
	/** A save is in progress. */
	Saving = "saving",
	/** The owner confirmed that the supplied document was saved. */
	Saved = "saved",
	/** The owner rejected or could not complete the save request. */
	Failed = "failed"
}

/** Stable initiative state supplied by a canvas document. */
export enum CanvasInitiativeStates
{
	/** The initiative is progressing within its supplied plan. */
	OnTrack = "on-track",
	/** The initiative needs attention to meet its supplied target. */
	AtRisk = "at-risk",
	/** The document does not yet classify the initiative as on track or at risk. */
	Pending = "pending"
}

/** Stable severity supplied by a canvas document for a described risk. */
export enum CanvasRiskSeverities
{
	/** A risk that requires prominent attention. */
	High = "high",
	/** A risk that remains visible without the high-severity treatment. */
	Medium = "medium"
}

/** A key initiative row in the canvas document table. */
export interface CanvasInitiative
{
	/** Initiative name. */
	name: string;
	/** Owning team. */
	owner: string;
	/** Target outcome. */
	target: string;
	/** Timeline window. */
	timeline: string;
	/** Lifecycle state supplied by the document authority. */
	status: CanvasInitiativeStates;
}

/** A growth-target metric row in the canvas document. */
export interface CanvasMetric
{
	/** Metric label. */
	label: string;
	/** Metric value. */
	value: string;
	/** Supporting note. */
	note: string;
}

/** A risk row in the canvas document. */
export interface CanvasRisk
{
	/** Risk description. */
	risk: string;
	/** Severity supplied by the document authority. */
	severity: CanvasRiskSeverities;
}

/** A complete read-only document rendered in the context canvas. */
export interface CanvasDocument
{
	/** Short title used in the canvas navigation bar. */
	navigationTitle: string;
	/** Full document heading shown in the canvas body. */
	title: string;
	/** Lifecycle supplied by the document authority. */
	lifecycle: CanvasDocumentLifecycles;
	/** Short line above the document saying where its content came from. */
	provenance: string;
	/** Source-supplied metadata values displayed below the heading. */
	metadata: readonly string[];
	/** Read-only executive summary supplied by the document authority. */
	executiveSummary: string;
	/** Growth or outcome metrics supplied by the document authority. */
	metrics: readonly CanvasMetric[];
	/** Initiative rows supplied by the document authority. */
	initiatives: readonly CanvasInitiative[];
	/** Risk rows supplied by the document authority. */
	risks: readonly CanvasRisk[];
	/** Number of citations that grounded this document. */
	citationCount: number;
	/** The boundary kinds the document's citations came from. */
	citationBoundaryKinds: readonly ResourceBoundaryKind[];
}
