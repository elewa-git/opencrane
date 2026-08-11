import { ElicitationBodyKinds, ElicitationRequestStates, type ElicitationBody, type ElicitationResponseValue } from "@opencrane/contracts";

/** Validate one answer against the exact persisted body without inferring authority. */
export function _IsElicitationResponseValid(body: ElicitationBody, response: ElicitationResponseValue): boolean
{
	if (body.kind !== response.kind) return false;
	if (body.kind === ElicitationBodyKinds.Approval && response.kind === ElicitationBodyKinds.Approval) return typeof response.approved === "boolean";
	if (body.kind === ElicitationBodyKinds.SingleChoice && response.kind === ElicitationBodyKinds.SingleChoice) return body.choices.some(function _Matches(choice): boolean { return choice.value === response.selection; });
	if (body.kind === ElicitationBodyKinds.MultipleChoice && response.kind === ElicitationBodyKinds.MultipleChoice)
	{
		const unique = new Set(response.selections);
		return unique.size === response.selections.length
			&& unique.size >= body.minimumSelections
			&& unique.size <= body.maximumSelections
			&& response.selections.every(function _Known(value): boolean { return body.choices.some(function _Matches(choice): boolean { return choice.value === value; }); });
	}
	if (body.kind === ElicitationBodyKinds.FreeText && response.kind === ElicitationBodyKinds.FreeText)
	{
		const length = Array.from(response.text).length;
		return length <= body.maximumLength && (body.allowEmpty || response.text.trim().length > 0);
	}
	return false;
}

/** Terminal request state selected from one valid response. */
export function _ElicitationStateForResponse(response: ElicitationResponseValue): ElicitationRequestStates.Answered | ElicitationRequestStates.Declined
{
	if (response.kind === ElicitationBodyKinds.Approval && !response.approved) return ElicitationRequestStates.Declined;
	return ElicitationRequestStates.Answered;
}
