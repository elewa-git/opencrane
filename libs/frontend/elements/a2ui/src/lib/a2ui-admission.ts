import type { Types } from "@a2ui/angular/v0_8";

import { A2uiComponentNames, A2uiEnvelopeVersions, A2uiSurfaceStates, type A2uiSurfacePresentation } from "./a2ui.types.js";

/** Maximum number of ordered protocol operations admitted in one display envelope. */
const _MAX_OPERATIONS = 256;

/** Maximum number of components admitted in one progressive surface update. */
const _MAX_COMPONENTS_PER_UPDATE = 256;

/** Maximum length of any stable coordinate or displayed action identifier. */
const _MAX_IDENTIFIER_LENGTH = 256;

/** Maximum length of a display-safe lifecycle explanation. */
const _MAX_REASON_LENGTH = 2000;

/** Component names admitted by the deliberately constrained catalogue. */
const _ADMITTED_COMPONENT_NAMES = new Set<string>(Object.values(A2uiComponentNames));

/** Presentation states admitted at the element boundary. */
const _ADMITTED_SURFACE_STATES = new Set<string>(Object.values(A2uiSurfaceStates));

/**
 * Verify the complete typed presentation before it reaches the vendor message processor.
 *
 * This is a defence-in-depth display check. The server and state layer still own decoding,
 * authorization, sequence reconstruction, and raw-payload exclusion.
 */
export function _AdmitA2uiSurfacePresentation(presentation: A2uiSurfacePresentation): boolean
{
	// 1. Check the fixed envelope vocabulary and coordinates so a malformed projection cannot
	// select another surface or an unowned lifecycle branch.
	if (presentation.version !== A2uiEnvelopeVersions.OpenCraneV1 || !_ADMITTED_SURFACE_STATES.has(presentation.state))
	{
		return false;
	}
	if (!_isIdentifier(presentation.conversationId) || !_isIdentifier(presentation.runId) || !_isIdentifier(presentation.messageId) || !_isIdentifier(presentation.surfaceId))
	{
		return false;
	}
	if (!Number.isSafeInteger(presentation.sequence) || presentation.sequence < 0)
	{
		return false;
	}
	if (presentation.reason !== undefined && presentation.reason.length > _MAX_REASON_LENGTH)
	{
		return false;
	}

	// 2. Bound and inspect every operation before preserving its supplied order for the processor.
	if (presentation.operations.length > _MAX_OPERATIONS)
	{
		return false;
	}
	for (const operation of presentation.operations)
	{
		if (!_isAdmittedOperation(operation, presentation.surfaceId))
		{
			return false;
		}
	}
	return true;
}

/** Whether a protocol operation is singular, surface-bound, bounded, and catalogue-safe. */
function _isAdmittedOperation(operation: Types.ServerToClientMessage, surfaceId: string): boolean
{
	const keys = Object.keys(operation);
	if (keys.length !== 1)
	{
		return false;
	}
	if (operation.beginRendering)
	{
		return operation.beginRendering.surfaceId === surfaceId;
	}
	if (operation.dataModelUpdate)
	{
		return operation.dataModelUpdate.surfaceId === surfaceId;
	}
	if (operation.deleteSurface)
	{
		return operation.deleteSurface.surfaceId === surfaceId;
	}
	if (!operation.surfaceUpdate || operation.surfaceUpdate.surfaceId !== surfaceId)
	{
		return false;
	}
	return _hasOnlyAdmittedComponents(operation.surfaceUpdate.components);
}

/** Whether a surface update contains a bounded list of one-contract component wrappers. */
function _hasOnlyAdmittedComponents(components: readonly unknown[]): boolean
{
	if (components.length === 0 || components.length > _MAX_COMPONENTS_PER_UPDATE)
	{
		return false;
	}
	for (const component of components)
	{
		if (!_isRecord(component) || typeof component["id"] !== "string" || !_isIdentifier(component["id"]) || !_isRecord(component["component"]))
		{
			return false;
		}
		const componentNames = Object.keys(component["component"]);
		if (componentNames.length !== 1 || !_ADMITTED_COMPONENT_NAMES.has(componentNames[0]))
		{
			return false;
		}
	}
	return true;
}

/** Whether a stable coordinate or action identifier is present and bounded. */
function _isIdentifier(value: string): boolean
{
	return value.length > 0 && value.length <= _MAX_IDENTIFIER_LENGTH;
}

/** Whether an unknown value is a non-null, non-array object. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
