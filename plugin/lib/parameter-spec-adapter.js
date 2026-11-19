
let droppedDuringAdaptation = [];
export function takeDroppedKeywords() {
  const seen = droppedDuringAdaptation;
  droppedDuringAdaptation = [];
  return seen;
}
export function lastDroppedKeywords() {
  return [...droppedDuringAdaptation];
}

const SUPPORTED_KEYWORDS = new Set([
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "description",
  "title",
  "default",
  "examples",
]);

function toSpecNode(node, requiredNames, nodePath = "") {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((entry, index) => toSpecNode(entry, [], `${nodePath}[${index}]`));

  const out = {};
  const required = new Set(requiredNames);
  for (const [key, value] of Object.entries(node)) {
    if (key === "required") continue;
    if (!SUPPORTED_KEYWORDS.has(key)) {
      droppedDuringAdaptation.push(`${nodePath === "" ? "" : `${nodePath}.`}${key}`);
      continue;
    }
    if (key === "properties" && value !== null && typeof value === "object") {
      out.properties = toSpecProperties(value, required, nodePath);
      continue;
    }
    if (key === "items") {
      out.items = toSpecNode(value, Array.isArray(value?.required) ? value.required : [], `${nodePath}.items`);
      continue;
    }
    if (key === "oneOf" && Array.isArray(value)) {
      out.oneOf = value.map((branch, index) => toSpecNode(branch, Array.isArray(branch?.required) ? branch.required : [], `${nodePath}.oneOf[${index}]`));
      continue;
    }
    out[key] = value;
  }
  if (out.type === "object" && !Object.hasOwn(out, "additionalProperties")) {
    out.additionalProperties = true;
  }
  return out;
}

function toSpecProperties(properties, requiredNames, nodePath = "") {
  const out = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    const converted = toSpecNode(value, Array.isArray(value?.required) ? value.required : [], nodePath === "" ? key : `${nodePath}.${key}`);
    if (requiredNames.has(key)) converted.required = true;
    out[key] = converted;
  }
  return out;
}

export function toParameterSpec(schema) {
  if (schema === null || typeof schema !== "object") return {};
  const properties = { ...(schema.properties ?? {}) };
  for (const name of COMPLETE_FRONTMATTER_PARAMETERS) {
    const node = properties[name];
    if (node === undefined || node === null || node.type !== "object") continue;
    const declared = node.properties ?? {};
    const missing = Object.fromEntries(
      Object.entries(CODE_MANAGED_PROPERTY_SPECS).filter(([field]) => !Object.hasOwn(declared, field)),
    );
    if (Object.keys(missing).length === 0) continue;
    properties[name] = { ...node, properties: { ...declared, ...missing } };
  }
  return toSpecProperties(properties, new Set());
}

const COMPLETE_FRONTMATTER_PARAMETERS = new Set(["frontmatter_after"]);

const CODE_MANAGED_PROPERTY_SPECS = Object.freeze({
  object_uid: { type: "string", description: "Code-managed identity: re-stamped by the writer, ignore on input" },
  fact_type_key: { type: "string", description: "Code-managed identity: re-stamped by the writer, ignore on input" },
  created_at: { type: "string", description: "Code-managed creation time: re-stamped by the writer, ignore on input" },
  change_log: {
    type: "array",
    items: { type: "object", additionalProperties: true },
    description: "Code-managed: the writer appends exactly one entry",
  },
});

const DROPPED_KEYWORDS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "pattern", "minLength", "maxLength", "format",
  "minItems", "maxItems", "uniqueItems", "contains",
  "minProperties", "maxProperties", "patternProperties", "propertyNames",
  "dependencies", "dependentRequired", "dependentSchemas",
  "anyOf", "allOf", "not", "if", "then", "else", "$ref", "$defs", "definitions",
]);

export function droppedConstraints(schema, path = "") {
  const found = [];
  const walk = (node, at) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${at}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const here = at === "" ? key : `${at}.${key}`;
      if (DROPPED_KEYWORDS.has(key)) found.push(here);
      else walk(value, here);
    }
  };
  walk(schema, path);
  return found;
}
