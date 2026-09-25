import { Injectable, InjectionToken, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import type { paths } from "@opencrane/contracts";

import { ToolApprovalScopeGatewayError, ToolApprovalScopeGatewayErrorKinds } from "./tool-approval-scope.errors";
import type { ToolApprovalScopeGateway } from "./tool-approval-scope.types";
import { _ParseToolApprovalScopeList, _ParseToolApprovalScopeRevocation } from "./tool-approval-scope.validator";

/** Generated request body for the requester-owned revocation endpoint. */
type _GeneratedRevocation = paths["/me/tool-approval-scopes/{scopeId}/revocation"]["post"]["requestBody"]["content"]["application/json"];

/** Browser composition token for requester-owned standing approvals. */
export const TOOL_APPROVAL_SCOPE_GATEWAY = new InjectionToken<ToolApprovalScopeGateway>("TOOL_APPROVAL_SCOPE_GATEWAY", { providedIn: "root", factory: function _Factory() { return inject(OpenCraneToolApprovalScopeGateway); } });

/** Generated-client adapter for listing and revoking the signed-in requester's standing approvals. */
@Injectable({ providedIn: "root" })
export class OpenCraneToolApprovalScopeGateway implements ToolApprovalScopeGateway
{
	/** Shared cookie-session API client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async list(cursor?: string, signal?: AbortSignal)
	{
		const query = cursor === undefined ? {} : { cursor };
		const { data, error, response } = await this._api.client.GET("/me/tool-approval-scopes", { params: { query }, signal });
		if (error !== undefined || !response.ok || data === undefined)
			throw _ReadError(response.status);
		return _ParseToolApprovalScopeList(data);
	}

	/** @inheritdoc */
	public async revoke(scopeId: string, idempotencyKey: string)
	{
		const body: _GeneratedRevocation = { idempotencyKey };
		try
		{
			const { data, error, response } = await this._api.client.POST("/me/tool-approval-scopes/{scopeId}/revocation", { params: { path: { scopeId } }, body });
			if (error !== undefined || !response.ok || data === undefined)
				throw response.status === 401 || response.status === 403 ? new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Forbidden) : new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Uncertain);
			return _ParseToolApprovalScopeRevocation(data);
		}
		catch (error)
		{
			if (error instanceof ToolApprovalScopeGatewayError)
				throw error;
			throw new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Uncertain);
		}
	}
}

/** Translate a failed list without copying a server response into browser state. */
function _ReadError(status: number): ToolApprovalScopeGatewayError
{
	return new ToolApprovalScopeGatewayError(status === 401 || status === 403 ? ToolApprovalScopeGatewayErrorKinds.Forbidden : ToolApprovalScopeGatewayErrorKinds.Unavailable);
}
