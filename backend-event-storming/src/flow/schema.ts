import type { DtoMap, FieldMap, SchemaLine } from "./types";

/** How deep nested DTOs are opened: the payload itself, plus one level inside. */
export const MAX_SCHEMA_DEPTH = 1;

/** `BookingScheduledCar.DTO` → `["BookingScheduledCar.DTO", false]`; `X[]` → array flag. */
export function parseType(raw: string): [base: string, isArray: boolean] {
  return raw.endsWith("[]") ? [raw.slice(0, -2), true] : [raw, false];
}

/**
 * Expand a payload into display lines, opening nested DTOs (from `dtos`) one
 * level at a time. Java payloads name their DTO as `Type` or `Type.DTO`; both
 * resolve to the same entry in the DTO map.
 *
 * Circular references stop at the type name, so a self-referencing DTO cannot
 * loop forever.
 */
export function flattenSchema(
  fields: FieldMap | undefined,
  dtos: DtoMap | undefined,
  indent = 0,
  visited: Set<string> = new Set(),
  depth = 0,
): SchemaLine[] {
  if (!fields) return [];
  const lines: SchemaLine[] = [];

  for (const [fieldName, fieldType] of Object.entries(fields)) {
    const typeStr = String(fieldType ?? "");
    const [baseType, isArray] = parseType(typeStr);
    const displayType = isArray ? `${baseType}[]` : typeStr;
    const nested = dtos?.[baseType] ?? dtos?.[baseType.replace(/\.DTO$/, "")];

    if (nested && !visited.has(baseType) && depth < MAX_SCHEMA_DEPTH) {
      visited.add(baseType);
      lines.push({ fieldName, typeName: baseType, indent, openDto: baseType });
      lines.push(...flattenSchema(nested, dtos, indent + 1, visited, depth + 1));
      lines.push({
        fieldName: "",
        typeName: "",
        indent,
        closeBrace: true,
        closeArray: isArray || undefined,
      });
    } else {
      // Circular reference guard, or a plain scalar type.
      lines.push({ fieldName, typeName: displayType, indent });
    }
  }

  return lines;
}

/** Line count used by the layout engine to reserve vertical space. */
export function schemaLineCount(fields: FieldMap | undefined, dtos: DtoMap | undefined): number {
  return flattenSchema(fields, dtos).length;
}


/** `Authorization: Bearer …` style cleanup for inline rule text. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
