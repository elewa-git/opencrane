import type { JsonValue } from "@opencrane/util";

/** A local Principal resolved from the trusted personal-owner subject. */
export interface PersonalAgentProductCaller
{
	/** Silo that owns the Principal and every personal-agent resource. */
	readonly siloId: string;
	/** Stable local Principal used by central authorization grants and decisions. */
	readonly principalId: string;
	/** External subject retained for the identity-bound personal lifecycle checks. */
	readonly subjectId: string;
}

/** Resources that establish the owner's current personal-agent access projection. */
export interface PersonalAgentCurrentResources
{
	/** Stable personal AgentService. */
	readonly agentServiceId: string;
	/** Active immutable AgentRevision. */
	readonly agentRevisionId: string;
	/** Persona profile selected by the active revision. */
	readonly personaProfileId: string;
	/** Model definition selected by the active revision. */
	readonly modelDefinitionId: string;
}

/** Resource categories whose selection creates a successor personal-agent revision. */
export enum PersonalAgentSelectedResourceKinds
{
	/** The owner selected an approved Persona profile for future runs. */
	Persona = "persona",
	/** The owner selected a ModelDefinition for future runs. */
	Model = "model",
}

/** Product effects needed to create and publish the first personal-agent revision. */
export interface AdmitInitialPersonalAgentPublicationCommand extends PersonalAgentCurrentResources
{
	/** Owner whose current managed grants and decisions are written. */
	readonly caller: PersonalAgentProductCaller;
	/** Trusted time shared with onboarding completion. */
	readonly now: Date;
	/** Canonical arguments recorded on every protected effect admission. */
	readonly argumentsValue: JsonValue;
}

/** Product effects needed to append one persona- or model-selection revision. */
export interface AdmitPersonalAgentRevisionSelectionCommand
{
	/** Owner whose current managed grants and decisions are written. */
	readonly caller: PersonalAgentProductCaller;
	/** Trusted time shared with the owning configuration or persona transaction. */
	readonly now: Date;
	/** Canonical arguments recorded on every protected effect admission. */
	readonly argumentsValue: JsonValue;
	/** Existing published resources that authorize editing the stable service. */
	readonly source: PersonalAgentCurrentResources;
	/** Successor resources that become grantable only after their rows exist. */
	readonly target: PersonalAgentCurrentResources;
	/** Resource whose use caused the new revision. */
	readonly selectedResource: PersonalAgentSelectedResourceKinds;
}

/** Central product-effect adapter used inside personal-agent Serializable transactions. */
export interface PersonalAgentProductEffects
{
	/** Resolves one trusted owner subject to exactly one local Principal. */
	resolveCaller(siloId: string, subjectId: string): Promise<PersonalAgentProductCaller | null>;
	/** Restores owner and selected-resource grants for an already-ready personal Agent. */
	reconcileCurrent(caller: PersonalAgentProductCaller, resources: PersonalAgentCurrentResources, now: Date): Promise<void>;
	/** Admits personal Agent creation against the pre-existing silo collection root. */
	admitInitialCreation(command: AdmitInitialPersonalAgentPublicationCommand): Promise<void>;
	/** Projects exact grants and admits publication after the first rows exist. */
	admitInitialPublication(command: AdmitInitialPersonalAgentPublicationCommand): Promise<void>;
	/** Admits a selection through the existing service and independently granted resource. */
	admitRevisionSelection(command: AdmitPersonalAgentRevisionSelectionCommand): Promise<void>;
	/** Projects exact successor grants and admits publication after its row exists. */
	admitRevisionPublication(command: AdmitPersonalAgentRevisionSelectionCommand): Promise<void>;
}
