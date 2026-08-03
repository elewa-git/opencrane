import { AgentConfigPatchKinds } from "@opencrane/contracts";

/** Closed configuration change that a future personal revision authority may materialise. */
export type PersonalConfigurationPatch = { readonly kind: AgentConfigPatchKinds.PersonaRefresh } | { readonly kind: AgentConfigPatchKinds.ModelAlias; readonly modelAlias: string };
