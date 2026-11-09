/**
 * Adapt a standard JSON Schema parameter object into the host's author-facing
 * schema DSL accepted by `defineTool()` (spark-5b0b380e).
 *
 * Why this exists: LDVH builds its parameter declarations as JSON Schema
 * (`{ type: "object", properties, required: [...], additionalProperties }`) and
 * registered them through `ctx.tools.register()` with a bare descriptor. That
 * entry point only asserts `output`/`timeoutMs`/reserved-name shape and stores
 * the definition verbatim — it performs NO argument validation. The DSH
 * argument check lives inside the `defineTool()` closure, so a tool registered
 * the old way never had its schema enforced.
 *
 * Two shape differences have to be bridged:
 *
 *   1. `required` is a sibling ARRAY in JSON Schema but a per-property
 *      `required: true` annotation in the DSL. Passing the array is rejected
 *      outright ("parameters.required must be a value schema object").
 *   2. The DSL's parameter root is an implicitly OPEN object — the model may
 *      always add undeclared top-level keys and it is not a violation. Only
 *      nested objects carrying `additionalProperties: false` are enforced.
 *
 * Consequently `minimum`/`maximum`/`pattern` (outside the host's supported
 * keyword subset) are dropped rather than forwarded, and the caller must not
 * rely on this adapter for root-level excess-key rejection. What it buys is
 * required-field enforcement and nested-object closure, which is where nearly
 * all of LDVH's parameter surface sits (`frontmatter_draft`, `frontmatter_after`,
 * relation entries, url entries).
 */

/** Keywords the host accepts on an author node (see dsh-tools schema subset). */
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

/**
 * Convert one JSON Schema node into DSL form.
 *
 * `required` is consumed at the parent level (it names sibling properties), so
 * this function is always called for a node whose required list is applied by
 * its caller. Unsupported constraint keywords are dropped silently — they were
 * never enforced before this adapter existed either, and forwarding them would
 * make `defineTool()` throw at definition time and take the whole tool down.
 */
function toSpecNode(node, requiredNames) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((entry) => toSpecNode(entry, []));

  const out = {};
  const required = new Set(requiredNames);
  for (const [key, value] of Object.entries(node)) {
    if (key === "required") continue; // handled via the sibling list
    if (!SUPPORTED_KEYWORDS.has(key)) continue; // minimum/pattern/... are not in the host subset
    if (key === "properties" && value !== null && typeof value === "object") {
      out.properties = toSpecProperties(value, required);
      continue;
    }
    if (key === "items") {
      out.items = toSpecNode(value, []);
      continue;
    }
    // `oneOf` branches are value schemas in their own right: a branch that is an
    // object carries its own `required` array, which must become per-property
    // annotations. Passing it through untouched is rejected by the host DSL
    // ("oneOf[1].required is not supported by the value schema DSL").
    if (key === "oneOf" && Array.isArray(value)) {
      out.oneOf = value.map((branch) => toSpecNode(branch, []));
      continue;
    }
    out[key] = value;
  }
  // The host DSL demands an explicit openness on every object node, while JSON
  // Schema treats a missing `additionalProperties` as open. Default it to `true`
  // (JSON Schema's own default) so the adaptation does not silently tighten a
  // previously-open object.
  if (out.type === "object" && !Object.hasOwn(out, "additionalProperties")) {
    out.additionalProperties = true;
  }
  return out;
}

/** Convert a properties map, stamping `required: true` on the named members. */
function toSpecProperties(properties, requiredNames) {
  const out = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    const converted = toSpecNode(value, Array.isArray(value?.required) ? value.required : []);
    if (requiredNames.has(key)) converted.required = true;
    out[key] = converted;
  }
  return out;
}

/**
 * Adapt a whole parameter schema (including its own `required` array) into the
 * DSL property map that `defineTool({ parameters })` expects.
 *
 * BOTH top-level and nested `required` are carried over and enforced. Missing a
 * required PARAMETER now fails in the DSH layer instead of reaching the handler.
 * That is a deliberate contract change: the host error is a hard stop, whereas
 * the LDVH envelope used to explain what to do next. Callers that relied on the
 * envelope for a missing top-level argument must read the `ToolArgsError` text.
 *
 * What this does NOT change: the host parameter root is an implicitly OPEN
 * object, so UNDECLARED top-level keys are still accepted here. Channel-外
 * fields are caught downstream by the writer's field closure, not by the schema.
 *
 * Returns the implicit property map directly: the DSL has no root object node,
 * so the root `type`/`additionalProperties` of the JSON Schema have no carrier.
 * That matches the host's open-root design rather than silently pretending to
 * close it.
 */
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
    // A closed object accepts the four; an open one would already tolerate them,
    // but declaring keeps the shape documented either way.
    properties[name] = { ...node, properties: { ...declared, ...missing } };
  }
  // Top-level requiredness deliberately stays with the handler: a missing
  // required PARAMETER is answered today with a structured `invalid_request`
  // envelope carrying `gaps` and a `follow_up` that tells the model what to do
  // next, which is more useful than the host's bare "missing required property".
  // Nested requiredness (object SHAPE) is still enforced — see the doc comment.
  return toSpecProperties(properties, new Set());
}

/**
 * Parameters whose value is a COMPLETE target frontmatter. Callers routinely
 * echo back what `*-read-object` returned, so the value necessarily carries the
 * Code-managed fields (`object_uid`, `fact_type_key`, `created_at`, `change_log`)
 * that the writer re-stamps unconditionally (02 §8.2 item 7; the same four the
 * `after-integrity` module calls CODE_MANAGED_FIELDS).
 *
 * Those fields were never declared in the JSON Schema used before this adapter,
 * because the schema was never enforced — a closed object simply never saw them.
 * Now that `defineTool` really validates, an echoed-back frontmatter would be
 * rejected as "not a declared property". Declaring them here is what keeps the
 * documented round-trip (read then update with the same object) working, and it
 * does not widen the channel: the writer overwrites all four regardless.
 */
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

/** Names of parameter keys the DSL will enforce as required (for assertions/tests). */
export function requiredParameterNames(schema) {
  return Array.isArray(schema?.required) ? [...schema.required] : [];
}
