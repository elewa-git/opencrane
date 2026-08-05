import ts from "typescript";

/** Resolve one statically named object property, or null when it may be dynamic. */
function _propertyName(property, sourceFile)
{
  if (ts.isSpreadAssignment(property)) return null;
  if (!ts.isComputedPropertyName(property.name)) return property.name.getText(sourceFile).replace(/^["']|["']$/g, "");
  return ts.isStringLiteralLike(property.name.expression) ? property.name.expression.text : null;
}

/** Resolve the final static kind after ordered properties and literal-object spreads. */
function _staticObjectKind(object, sourceFile)
{
  let kind;
  for (const property of object.properties)
  {
    if (ts.isSpreadAssignment(property))
    {
      if (!ts.isObjectLiteralExpression(property.expression)) return null;
      const spreadKind = _staticObjectKind(property.expression, sourceFile);
      if (spreadKind === null) return null;
      if (spreadKind !== undefined) kind = spreadKind;
      continue;
    }
    const name = _propertyName(property, sourceFile);
    if (name === null) return null;
    if (name !== "kind") continue;
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) return null;
    kind = property.initializer.text;
  }
  return kind;
}

/** Prove that a Job kind is only an owner reference nested in an effective Secret resource. */
export function _IsSecretJobOwnerReference(node, sourceFile)
{
  const ownerReferences = node.parent;
  const ownerReferencesProperty = ownerReferences?.parent;
  const metadata = ownerReferencesProperty?.parent;
  const metadataProperty = metadata?.parent;
  const resource = metadataProperty?.parent;
  return !!ownerReferences && ts.isArrayLiteralExpression(ownerReferences) && !!ownerReferencesProperty && ts.isPropertyAssignment(ownerReferencesProperty) && ownerReferencesProperty.name.getText(sourceFile) === "ownerReferences" && !!metadata && ts.isObjectLiteralExpression(metadata) && !!metadataProperty && ts.isPropertyAssignment(metadataProperty) && metadataProperty.name.getText(sourceFile) === "metadata" && !!resource && ts.isObjectLiteralExpression(resource) && _staticObjectKind(resource, sourceFile) === "Secret";
}
