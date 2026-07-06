import type { JsonSchema } from "./tools.js";

export type McpValidationIssue = {
  path: string;
  message: string;
};

export class McpValidationError extends Error {
  readonly errors: McpValidationIssue[];

  constructor(errors: McpValidationIssue[]) {
    super(`MCP validation failed: ${errors.map((error) => `${error.path} ${error.message}`).join("; ")}`);
    this.name = "McpValidationError";
    this.errors = errors;
  }
}

export function assertValidJsonSchemaValue(schema: JsonSchema, value: unknown, rootPath = "$"): void {
  const errors: McpValidationIssue[] = [];
  validateValue(schema, value, rootPath, errors);
  if (errors.length > 0) {
    throw new McpValidationError(errors);
  }
}

function validateValue(schema: JsonSchema, value: unknown, path: string, errors: McpValidationIssue[]): void {
  if (schema.oneOf) {
    const matchCount = schema.oneOf.filter((candidate) => isValid(candidate, value, path)).length;
    if (matchCount !== 1) {
      errors.push({
        path,
        message: matchCount === 0 ? "does not match any allowed schema" : "matches more than one allowed schema"
      });
    }
    return;
  }

  if (schema.enum && !schema.enum.some((item) => isJsonEqual(item, value))) {
    errors.push({ path, message: `must be one of ${schema.enum.map(formatValue).join(", ")}` });
    return;
  }

  if (schema.type && !matchesType(schema.type, value)) {
    errors.push({ path, message: `must be ${formatType(schema.type)}` });
    return;
  }

  const activeType = schemaTypeForValue(schema, value);
  if (activeType === "object") {
    validateObject(schema, value as Record<string, unknown>, path, errors);
  } else if (activeType === "array") {
    validateArray(schema, value as unknown[], path, errors);
  } else if (activeType === "string") {
    validateString(schema, value as string, path, errors);
  } else if (activeType === "number") {
    validateNumber(schema, value as number, path, errors);
  }
}

function validateObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  errors: McpValidationIssue[]
): void {
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      errors.push({ path: appendPath(path, key), message: "is required" });
    }
  }

  for (const [key, item] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      validateValue(propertySchema, item, appendPath(path, key), errors);
    } else if (schema.additionalProperties === false) {
      errors.push({ path: appendPath(path, key), message: "is not allowed" });
    }
  }
}

function validateArray(schema: JsonSchema, value: unknown[], path: string, errors: McpValidationIssue[]): void {
  if (!schema.items) return;
  value.forEach((item, index) => validateValue(schema.items!, item, `${path}[${index}]`, errors));
}

function validateString(schema: JsonSchema, value: string, path: string, errors: McpValidationIssue[]): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({ path, message: `must be at least ${schema.minLength} characters` });
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({ path, message: `must be at most ${schema.maxLength} characters` });
  }
  if (schema.format === "date-time" && !isDateTime(value)) {
    errors.push({ path, message: "must be a valid date-time" });
  }
}

function validateNumber(schema: JsonSchema, value: number, path: string, errors: McpValidationIssue[]): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ path, message: `must be greater than or equal to ${schema.minimum}` });
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({ path, message: `must be less than or equal to ${schema.maximum}` });
  }
}

function isValid(schema: JsonSchema, value: unknown, path: string): boolean {
  const errors: McpValidationIssue[] = [];
  validateValue(schema, value, path, errors);
  return errors.length === 0;
}

function matchesType(type: string | string[], value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => matchesSingleType(item, value));
}

function matchesSingleType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function schemaTypeForValue(schema: JsonSchema, value: unknown): string | undefined {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  return types.find((type) => matchesSingleType(type, value));
}

function appendPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function formatType(type: string | string[]): string {
  return Array.isArray(type) ? type.join(" or ") : type;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function isJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}
