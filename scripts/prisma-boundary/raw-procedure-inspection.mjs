import ts from "typescript";

/**
 * Proves that a scanner match is the policy-declared tagged template inside its transaction-bound adapter method.
 * Any parse error, changed method shape, or additional raw use returns `undefined`, which makes the boundary checker reject the exception.
 *
 * @param source Complete TypeScript source for the declared adapter.
 * @param match Raw Prisma method match found by the scanner.
 * @param procedure Policy declaration that fixes the adapter, method, and SQL template.
 * @param prismaNamespace Imported Prisma namespace used by the transaction-client assertion.
 * @returns The matched SQL template, or `undefined` when the source does not prove the declared exception.
 * Called by: `_RawProcedureEvidence` in `scripts/prisma-boundary/inspection.mjs`.
 */
export function inspectRawProcedureCall(source, match, procedure, prismaNamespace)
{
	const sourceFile = ts.createSourceFile(procedure.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	if (sourceFile.parseDiagnostics.length > 0) return undefined;
	const tag = _MatchingRawTag(sourceFile, match);
	if (tag === undefined || tag.typeArguments?.length !== 1 || !_HasDirectRawUse(tag)) return undefined;
	if (!ts.isPropertyAccessExpression(tag.tag) || !ts.isIdentifier(tag.tag.expression) || tag.tag.expression.text !== "client" || tag.tag.name.text !== match.method) return undefined;
	const method = _Ancestor(tag, ts.isMethodDeclaration);
	const owner = _Ancestor(tag, ts.isClassDeclaration);
	const operation = procedure.adapter === "WorkflowTaskAdmission" ? "admit" : procedure.adapter === "WorkflowTaskEventAdmission" ? "emit" : undefined;
	if (method === undefined || owner === undefined || operation === undefined || !_IsIdentifierNamed(owner.name, procedure.adapter) || !_IsIdentifierNamed(method.name, operation)) return undefined;
	if (_Ancestor(tag, ts.isFunctionLike) !== method || method.body === undefined || !_HasSafeParameters(method)) return undefined;
	const [guard, binding] = method.body.statements;
	if (!_IsTransactionGuard(guard) || !_IsTransactionBinding(binding, prismaNamespace) || tag.getStart(sourceFile) <= binding.end) return undefined;
	if (!_HasOnlyApprovedRawTag(method.body.statements.slice(2), tag)) return undefined;
	const template = tag.template.getText(sourceFile);
	return template.startsWith("`") && template.endsWith("`") ? template.slice(1, -1) : undefined;
}

/** Locates the tagged template represented by one raw-method scanner match. */
function _MatchingRawTag(sourceFile, match)
{
	const offset = match.index ?? -1;
	const candidates = [];
	function _Visit(node)
	{
		if (ts.isTaggedTemplateExpression(node)
			&& ts.isPropertyAccessExpression(node.tag)
			&& node.tag.expression.end <= offset
			&& offset < node.tag.name.end)
		{
			candidates.push(node);
		}
		ts.forEachChild(node, _Visit);
	}
	_Visit(sourceFile);
	return candidates.length === 1 ? candidates[0] : undefined;
}

/** Returns the nearest ancestor of one syntax kind. */
function _Ancestor(node, predicate)
{
	let candidate = node.parent;
	while (candidate !== undefined)
	{
		if (predicate(candidate)) return candidate;
		candidate = candidate.parent;
	}
	return undefined;
}

/** Requires plain parameters so no initializer runs before the transaction guard. */
function _HasSafeParameters(method)
{
	if (method.parameters.length === 0) return false;
	for (const parameter of method.parameters)
	{
		if (!ts.isIdentifier(parameter.name) || parameter.initializer !== undefined || parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined) return false;
	}
	const first = method.parameters[0];
	return first.name.text === "transactionClient" && first.type?.kind === ts.SyntaxKind.UnknownKeyword;
}

/** Requires the guard as the method's first executable statement. */
function _IsTransactionGuard(statement)
{
	if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
	const call = statement.expression;
	return _IsIdentifierNamed(call.expression, "_RequireWorkflowTransactionClient")
		&& call.arguments.length === 1
		&& _IsIdentifierNamed(call.arguments[0], "transactionClient");
}

/** Requires the sole immutable client alias as the method's second statement. */
function _IsTransactionBinding(statement, prismaNamespace)
{
	if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) return false;
	const declaration = statement.declarationList.declarations[0];
	if (!_IsIdentifierNamed(declaration.name, "client") || !ts.isAsExpression(declaration.initializer) || !_IsIdentifierNamed(declaration.initializer.expression, "transactionClient")) return false;
	const type = declaration.initializer.type;
	return ts.isTypeReferenceNode(type)
		&& ts.isQualifiedName(type.typeName)
		&& _IsIdentifierNamed(type.typeName.left, prismaNamespace)
		&& _IsIdentifierNamed(type.typeName.right, "TransactionClient");
}

/** Allows one tag and permits the client alias only as that tag's direct receiver. */
function _HasOnlyApprovedRawTag(statements, approvedTag)
{
	let valid = true;
	function _Visit(node)
	{
		if (!valid) return;
		if (ts.isTaggedTemplateExpression(node) && node !== approvedTag) valid = false;
		if (ts.isIdentifier(node))
		{
			if (node.text === "transactionClient" || node.text === "arguments" || node.text === "eval" || node.text === "Reflect") valid = false;
			if (node.text === "client" && node !== approvedTag.tag.expression) valid = false;
		}
		ts.forEachChild(node, _Visit);
	}
	for (const statement of statements) _Visit(statement);
	return valid;
}

/** Requires the raw tag to be awaited or returned directly, never wrapped in another expression. */
function _HasDirectRawUse(tag)
{
	const parent = ts.isAwaitExpression(tag.parent) ? tag.parent.parent : tag.parent;
	return ts.isExpressionStatement(parent) || ts.isReturnStatement(parent) || ts.isVariableDeclaration(parent);
}

/** Returns whether a syntax node is an identifier with one normalized name. */
function _IsIdentifierNamed(node, name)
{
	return node !== undefined && ts.isIdentifier(node) && node.text === name;
}
