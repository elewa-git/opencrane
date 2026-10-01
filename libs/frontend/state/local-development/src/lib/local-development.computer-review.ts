import { type ConversationComputerReviewGateway } from "@opencrane/state/conversation/workspace";

/** Rejects computer review because Agent Sandbox belongs to Tier 3. */
function _ComputerUnavailable(): never
{
	throw new Error("Conversation Computer is available in Tier 3 local development.");
}

/**
 * Rejects every computer-review operation because Tier 1 has no Agent Sandbox.
 * Returning fixture data here would let the frontend imply that an unprovisioned computer performed work.
 */
export function _CreateLocalDevelopmentComputerReview(): ConversationComputerReviewGateway
{
	/** Rejects local file reads because Tier 1 has no Agent Sandbox. */
	async function _ReadComputerFile()
	{
		return _ComputerUnavailable();
	}

	/** Rejects local diff reads because Tier 1 has no Agent Sandbox. */
	async function _ReadComputerDiff()
	{
		return _ComputerUnavailable();
	}

	/** Rejects local commands because Tier 1 has no Agent Sandbox. */
	async function _RunComputerCommand()
	{
		return _ComputerUnavailable();
	}

	/** Rejects browser target discovery because Tier 1 has no Agent Sandbox. */
	async function _ListComputerBrowserTargets()
	{
		return _ComputerUnavailable();
	}

	/** Rejects browser navigation because Tier 1 has no Agent Sandbox. */
	async function _OpenComputerBrowserPage()
	{
		return _ComputerUnavailable();
	}

	/** Rejects screenshot capture because Tier 1 has no Agent Sandbox. */
	async function _CaptureComputerScreenshot()
	{
		return _ComputerUnavailable();
	}

	/** Rejects browser previews because Tier 1 has no Agent Sandbox. */
	async function _ReadComputerPreview()
	{
		return _ComputerUnavailable();
	}

	return {
		readComputerFile: _ReadComputerFile,
		readComputerDiff: _ReadComputerDiff,
		runComputerCommand: _RunComputerCommand,
		listComputerBrowserTargets: _ListComputerBrowserTargets,
		openComputerBrowserPage: _OpenComputerBrowserPage,
		captureComputerScreenshot: _CaptureComputerScreenshot,
		readComputerPreview: _ReadComputerPreview
	};
}
