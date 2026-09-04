# DSH Host Service & Event Reference

> ⚠️ **基线过时（2026-09-06 发现）**：本文基于旧版解包。上游已更新 **0.1.2-rc.1（desktop 2.0.5）**。全量差异与逐项证据见 **docs/dsh-0.1.2-upgrade-survey.md**（本文修订前以该调查为准）。


> **Scope**: DeepSeek Harness host composition — Cordis services, event channels, and
> agent-lifecycle hooks available to plugins and agent presets. All identifiers,
> shapes, and behaviors are derived from the packed `app.asar.unpacked` checkout at
> `/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/`. This
> document is read-only reference; it does not copy DSH source code.

---

## 1. Service Key Registry

Every service is a Cordis `Service` subclass whose constructor calls
`super(ctx, "keyName")`, which registers it as `ctx.get("keyName")`. A service
exists only when its owning plugin is activated in the current composition.

| Service key | Package | Notes |
|---|---|---|
| `agents` | `dsh-agent` | Live agent registry + factory |
| `agentLoop` | `dsh-agent-loop` | Concrete agent factory & driver |
| `sessions` | `dsh-session` | Session store |
| `sessionPersistence` | `dsh-session-persistence` | JSONL persistence backend |
| `llm` | `dsh-llm` | LLM model/route abstraction |
| `tools` | `dsh-tool-cordis` (ToolRuntime) | Tool schema registry & executor |
| `systemPrompt` | `dsh-system-prompt` | Prompt section/context/variable registry |
| `credentials` | `dsh-credentials` | Credential provider |
| `storage` | `dsh-storage` | Generic key-value storage |
| `fs` | `dsh-fs` | FileSystem backend (base class) |
| `sandbox` | `dsh-sandbox` | Abstract sandbox service |
| `sandboxPolicy` | `dsh-sandbox-policy` | Sandbox policy |
| `jobs` | `dsh-jobs` | Abstract job registry (needs impl) |
| `goals` | `dsh-goal` | Goal lifecycle manager |
| `skills` | `dsh-skill` | Skill registry |
| `commands` | `dsh-commands` | Slash-command registry |
| `subagents` | `dsh-subagent` | Durable subagent continuation manager |
| `attachments` | `dsh-attachment` | Image/attachment store |
| `compaction` | `dsh-compaction` | Abstract compaction engine |
| `planMode` | `dsh-plan-mode` | Plan-mode controller |
| `webServer` | `dsh-host-webserver` | HTTP server (register / registerFallback) |
| `spillStore` | `dsh-spill` | Spill data store |
| `cordisInspect` | `dsh-cordis-host-runner` | Cordis Inspect registry |
| `dynamicCordisRunner` | `dsh-cordis-host-runner` | Dynamic plugin activation runner |
| `pluginInventory` | `dsh-host-plugin-inventory` | Plugin inventory |
| `directoryPicker` | `dsh-host-directory-picker` | Directory picker service |
| `sessionProjections` | `dsh-session-projection` | Session projection registry |
| `sessionProjectionCache` | `dsh-session-projection-cache` | Projection cache |
| `sessionQuery` | `dsh-session-query` | Session query engine |
| `sessionTelemetry` | `dsh-session-telemetry` | Telemetry backend |
| `messageFeedback` | `dsh-message-feedback` | Message feedback service |
| `tokenMeter` | `dsh-token-meter` | Token metering |
| `toolResultPruner` | `dsh-compaction-tool-result-pruner` | Tool result pruner |
| `sessionReferenceResolver` | `dsh-session-reference` | Session reference resolver |
| `session` (namespace) | `dsh-api-session-controller` | Session controller API |
| `skills` (namespace) | `dsh-api-session-controller` | Session skill catalog API |
| `fileReferences` (namespace) | `dsh-api-session-controller` | Session file references API |
| `credentials` (namespace) | `dsh-api-settings-controller` | Credentials controller API |
| `settings` (namespace) | `dsh-api-settings-controller` | Settings controller API |
| `timer` | `dsh-cordis-client-runner` | Client-side timer |

**Note**: Abstract services (`jobs`, `compaction`, `sandbox`) are base classes; a concrete
implementation must be loaded for their methods to be available.

---

## 2. Injection vs. Get

### `ctx.get(key)`

```js
const service = ctx.get("keyName");   // → Service | undefined
```

Synchronous, immediate. Returns `undefined` when the service is absent. For optional
services, use a guard:

```js
const prompt = ctx.get("systemPrompt");
if (prompt !== undefined) prompt.section({ name: "my-section", text: "..." });
```

### `ctx.inject([key, ...], (childCtx) => { ... })`

```js
const dispose = ctx.inject(["requiredService"], (childCtx) => {
  // childCtx: new isolated scope with requiredService resolved
  childCtx.on("agent/created", handler);
  return () => { /* cleanup */ };
});
// dispose() removes the binding and runs cleanup
```

- **Hard dependency**: Cordis waits for the service before running the callback.
- `childCtx` is a new scope child; parent services are inherited, overridden if
  the injected service is also in the parent chain.
- Returns a **disposer** function (can be `yield`d inside a `ctx.effect`).
- Inject **multiple** services: `ctx.inject(["agents", "llm"], (childCtx) => { ... })`.

### `ctx.inject` with optional service

```js
ctx.inject(["optionalService"], (childCtx) => {
  if (childCtx.get("optionalService") === undefined) return;
  // ...
});
```

---

## 3. Event Bus (`ctx.events`)

Installed on every context as `ctx.events`. Supports five dispatch modes:

| Mode | Behavior |
|---|---|
| `emit(...)` | Fire-and-forget; all listeners run synchronously, no await |
| `parallel(...)` | `Promise.allSettled`; throws `AggregateError` on any rejection |
| `serial(...)` | Sequential await; stops and returns on first **bail value** |
| `bail(...)` | Synchronous serial; stops on first bail value |
| `waterfall(...)` | AOP around a `next()` final callback (outermost listener runs first) |

### Registering listeners

```js
// Basic — append to end of list
const dispose1 = ctx.on("event/name", (arg1, arg2) => { ... });

// Prepend — runs first
const dispose2 = ctx.on("event/name", handler, true);
// or
const dispose2 = ctx.on("event/name", handler, { prepend: true });

// Once
const dispose3 = ctx.once("event/name", (arg) => { ... });
```

All listeners are automatically disposed when the owning fiber unloads.

### Scope filtering

By default, a listener only fires when the dispatch's carrier context matches the
listener's registration context (or an ancestor). Pass `{ global: true }` to bypass:

```js
ctx.on("event/name", handler, { global: true });  // fires regardless of scope
```

---

## 4. Agent Lifecycle Events

### `agent/created`

```ts
payload: { agent: Agent; }
```

Fires when an agent is published to the registry. **Best place to install
per-agent handlers**: `agent.ctx.on(...)`.

```js
ctx.on("agent/created", ({ agent }) => {
  agent.ctx.on("session/event", (session, event) => { /* ... */ });
  agent.ctx.on("system-prompt/assemble", assembleHandler);
});
```

### `agent/session-start`

```ts
payload: { agent: Agent; }
```

Fires when the agent's session enters the store and is announced. Use for
session-scope priming.

### `agent/pre-step` — **Waterfall**

```ts
payload: {
  messages: Message[];
  agent: Agent;
  turn: number;
  step: number;
  signal: AbortSignal;
}
```

Waterfall dispatch — the only way to modify assembled messages before the model
sees them.

```js
// Handler signature
async (payload, next) => {
  // payload.messages: claimed inbox messages
  // payload.signal: turn cancellation signal
  const decision = await next();           // → { kind: "enter", messages: [...] }
  if (decision.kind === "reject") return decision;

  // decision.messages is the assembled user-context array
  const modified = [...decision.messages, myInjection];
  return { ...decision, messages: modified };
}
```

- `next()` resolves to `{ kind: "enter", messages: [...] }` (from `systemPrompt.assemble`).
- Return `{ kind: "reject" }` to block the step entirely.
- Return a modified decision to inject content into the model's context.
- **Use `{ prepend: true }`** to make your handler the outermost participant.

### `agent/turn-stopping` — **Serial**

```ts
payload: { agent: Agent; turn: number; signal: AbortSignal; }
```

Serial dispatch when a turn ends and the inbox is empty. No return value consumed.
Use for reflection, analytics, or deferred processing.

```js
ctx.on("agent/turn-stopping", (payload) => {
  // payload.agent, payload.turn, payload.signal
});
```

### `session/event`

```ts
session: Session;
event: { type: string; data: any; seq: number; };
```

Every session event. Common types: `turn/start`, `step/start`, `step/end`,
`turn/end`, `user/message`, `model/message`, `tool/call`, `tool/result`.

```js
agent.ctx.on("session/event", (session, event) => {
  if (event.type === "turn/end") { /* ... */ }
});
```

### `agent/disposed`

```ts
payload: { agent: Agent; }
```

Fires when an agent is unregistered. Fiber-owned cleanup happens automatically;
no explicit handler needed unless you have non-fiber-owned resources.

---

## 5. system-prompt/assemble — **Waterfall**

```ts
assembly: {
  sections: Array<{
    name: string;
    text: string | ((context: AssembleContext) => string);
    order: number;
    complete?: boolean;
  }>;
  variables: Record<string, string>;
};
context: AssembleContext & {
  agent?: Agent;
  signal?: AbortSignal;
  // ...plugin-defined fields
};
```

The waterfall is the **ONLY** guidance injection point for per-turn content.

```js
async (assembly, context, next) => {
  // context.agent is always present when called from preStep
  if (context?.agent === undefined) return next();

  const result = await next();  // → assembly with other handlers applied

  // Filter or append sections
  const filtered = result.sections.filter(s => s.name !== MY_SECTION);
  filtered.push({ name: MY_SECTION, text: myText });
  return { ...result, sections: filtered };
}
```

**Use `{ prepend: true }`** on the `ctx.on` call to ensure your section appears
at the outermost position (processed last, but rendered in section order).

---

## 6. Key Service Methods

### `ctx.systemPrompt`

```js
// Register a prompt section
ctx.systemPrompt.section({
  name: string;      // unique within scope
  order: number;     // sort key
  text: string | ((context) => string);
  complete?: boolean;
});  // → disposer

// Register dynamic context
ctx.systemPrompt.context({
  name: string;
  order: number;
  text: string;
});  // → disposer

// Suppress runtime context contributions
ctx.systemPrompt.suppressRuntimeContext();  // → disposer

// Register a tool-schema provider
ctx.systemPrompt.tools((context) => ({
  schemas: [{ name, description, parameters }],
  knownNames?: string[];
}));  // → disposer

// Register a prompt variable
ctx.systemPrompt.variable(name, (context) => string | undefined);  // → disposer

// Assemble the full prompt
await ctx.systemPrompt.assemble(context);  // → PromptAssembly
```

### `ctx.commands`

```js
// Register a slash command
ctx.commands.register({
  name: string;          // no slash prefix
  description: string;
  input?: { hint?: string; images?: boolean; };
  recordInput?: boolean; // default true; set false to skip input logging
  handler: ({ agent, rawInput, attachments, commandId }) => {
    // returns: { kind: "success", text: string }
    //        | { kind: "error", text: string }
  };
});  // → disposer

// List effective commands for an agent
ctx.commands.list(agent);  // → CommandDescriptor[]

// Find one command
ctx.commands.find(agent, name);  // → CommandDefinition | undefined

// Parse and execute a command line
await ctx.commands.execute(agent, line, images, signal);
// → { commandId, result: { kind, text } } | undefined
```

### `ctx.skills`

```js
// Register a skill provider (synchronous, for same-process skills)
ctx.skills.registerProvider((control) => {
  // control.signal: abort signal
  // control.invalidate(): call when skill content changes
  return { name, invoke };
});  // → disposer

// Register a runtime skill
ctx.skills.register(skillDefinition);  // → disposer

// List effective skills for a scope
await ctx.skills.list(scope);  // → SkillSummary[]

// Get one skill's full content
await ctx.skills.load(name);  // → Skill | undefined
```

### `ctx.goals`

```js
// Get current goal for an agent
ctx.goals.get(agent);  // → GoalView | undefined

// Disarm (remove continuation authority without clearing durable state)
ctx.goals.disarm(agent);  // → GoalView | undefined

// Create and arm a goal
ctx.goals.create(agent, { objective, maxGoalRounds? });  // → GoalView

// Edit objective or round cap
ctx.goals.edit(agent, goalId, revision, { objective?, maxGoalRounds? });  // → GoalView

// Mark complete
ctx.goals.complete(agent, goalId, revision);  // → GoalView

// Mark blocked (reason required)
ctx.goals.block(agent, goalId, revision, { blocked_reason });  // → GoalView
```

### `ctx.subagents`

```js
// Start a durable continuable child
await ctx.subagents.startContinuable({
  provider?: string;
  model?: string;
  prompt: string;
  signal?: AbortSignal;
});  // → { childId, messageId }

// Send a followup message to a child
await ctx.subagents.followup(parent, childId, content, { signal? });
// → { messageId }

// Interrupt a child
ctx.subagents.interrupt(childSessionId, authority);  // fire-and-forget

// Report content from child to parent
await ctx.subagents.reportFrom(child, content, { schedule? });
// → { messageId }

// Register a capability installed into every child context
ctx.subagents.registerContinuableSetup((childCtx) => {
  // install services/tools into childCtx
  return () => { /* cleanup */ };
});  // → disposer
```

### `ctx.session` (Agent's session)

```js
// Append a session event
ctx.session.append(type, data, { surfaceOp? });  // → seq number

// Flush durability checkpoint
await ctx.session.flush(signal?);  // → void

// Dispatch any session event to listeners
ctx.session.event(type, data);  // → void
```

### `ctx.jobs`

```js
// Abstract base — requires concrete implementation (e.g., dsh-jobs-local)
// Common interface:
ctx.jobs.create(request);       // → JobId
ctx.jobs.get(id);               // → Job | undefined
ctx.jobs.list();                // → Job[]
ctx.jobs.abort(id);             // → void
```

---

## 7. Service Invocation Syntax

### Callable services (Service.invoke)

Some services are wrapped as callables. After `Service.invoke` is defined on a
class, the instance itself is a function:

```js
// ctx.logger is callable: ctx.logger("message") vs ctx.logger.info("message")
// Depends on whether the class defines Service.invoke
```

### Property access

Most services expose methods as regular properties:

```js
ctx.systemPrompt.section({ name: "test", order: 1, text: "hi" });
ctx.commands.register({ name: "test", handler });
ctx.goals.create(agent, { objective: "do the thing" });
ctx.subagents.startContinuable({ prompt: "..." });
```

---

## 8. Persistence Service (`sessionPersistence`)

```js
// Read a session's raw artifact text verbatim
await ctx.sessionPersistence.readRaw(sessionId, signal?);
// → { content: string; header: ParsedHeader } | undefined

// Prepare an unpublished session for resume
await ctx.sessionPersistence.prepare(id, signal?);
// → SessionPreparation

// List persisted session headers
await ctx.sessionPersistence.list();
// → SessionHeader[]
```

---

## 9. Projections (`sessionProjections`)

```js
// Register a projection
ctx.sessionProjections.register({
  key: string;              // unique identifier
  stateSchema: ZodSchema;  // state shape
  init: () => initialState;
  apply: (state, event) => newState;
  wire: {
    viewSchema: ZodSchema;
    view: (state) => projectedView;
  };
  stateVersion: number;
});  // → disposer

// Read a projection (via session event stream or direct API)
```

---

## 10. Agent Object Reference

```ts
Agent {
  id: string;
  session: Session;
  ctx: Context;           // agent's own scoped context
  options: {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
    cwd?: string;
  };
}
```

**Important**: `agent.ctx` is a scoped child context. Services resolved from
`agent.ctx` are scoped to this agent. Listeners on `agent.ctx` auto-dispose when
the agent disposes.

---

## 11. Common Plugin Patterns

### Pattern A: Install per-agent handlers at `agent/created`

```js
ctx.on("agent/created", ({ agent }) => {
  // agent.ctx is the agent's scoped context
  agent.ctx.on("system-prompt/assemble", createAssembleHandler(agent, deps));
  agent.ctx.on("agent/pre-step", createPreStepHandler(agent, deps));
  agent.ctx.on("agent/turn-stopping", createTurnStopHandler(agent, deps));
  agent.ctx.on("session/event", createSessionEventHandler(agent, deps));
});
```

### Pattern B: Wait for services before installing

```js
ctx.inject(["agents", "llm"], (childCtx) => {
  // Both services guaranteed available
  childCtx.on("agent/created", ({ agent }) => {
    agent.ctx.llm?.someMethod();
  });
  return () => { /* cleanup */ };
});
```

### Pattern C: Install at compose-level for global effects

```js
apply(ctx) {
  // No agent needed — global scope
  ctx.systemPrompt.section({ name: "global", order: 999, text: "..." });
  ctx.on("settings/updated", (namespace, next) => {
    // respond to settings changes
  });
}
```

### Pattern D: Yield disposer in composite effect

```js
ctx.effect(function* () {
  const stop = ctx.on("agent/created", handler);
  yield stop;  // ensures ordering: unregister before next sibling effect
}, "my-plugin.lifecycle()");
```

---

## 12. Event Name Reference

| Event | Dispatch mode | Key payload fields |
|---|---|---|
| `agent/created` | emit | `{ agent }` |
| `agent/session-start` | emit | `{ agent }` |
| `agent/pre-step` | **waterfall** | `{ messages, agent, turn, step, signal }` |
| `agent/turn-stopping` | serial | `{ agent, turn, signal }` |
| `agent/disposed` | emit | `{ agent }` |
| `session/event` | emit | `(session, event)` |
| `session/created` | emit | `(session)` |
| `session/disposed` | emit | `(session)` |
| `system-prompt/assemble` | **waterfall** | `(assembly, context, next)` |
| `settings/updated` | serial | `(namespace, next)` |
| `settings/document-updated` | emit | `(namespace)` |
| `internal/dispatch` | emit | `(type, name, args, thisArg)` |
| `internal/listener` | bail | internal hook registration |
| `internal/update` | waterfall | config update chain |
| `agent-loop/config-start-failed` | emit | `{ sessionId, error }` |

---

*Generated from `@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`,
`@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-session`,
`@deepseek-ai/dsh-session-persistence`, `@deepseek-ai/dsh-system-prompt`,
`@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-skill`,
`@deepseek-ai/dsh-goal`, `@deepseek-ai/dsh-subagent`,
`@deepseek-ai/dsh-plan-mode`, `@deepseek-ai/dsh-host-webserver`,
`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-session-projection`,
`@deepseek-ai/dsh-cordis-host-runner`, and
`@deepseek-ai/dsh-api-session-controller`.*
