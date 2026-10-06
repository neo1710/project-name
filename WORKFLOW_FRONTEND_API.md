# Workflow Builder Frontend API

Base URL locally: `http://localhost:3000/workflows`.

This is the single frontend contract for building, saving, and running workflow graphs. The initial runtime executes `prompt_agent` nodes and `knowledge_base_search` tools. MCP, HTTP, conditions, sandbox execution, and autonomous function calls remain intentionally unavailable until their dedicated runtimes are added.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/workflows/registry` | Load supported node, agent, and tool types for the canvas. |
| `POST` | `/workflows` | Create a new workflow. |
| `GET` | `/workflows` | List all workflows. |
| `GET` | `/workflows?ownerId=:ownerId` | List one owner's workflows. |
| `GET` | `/workflows?skip=0&limit=20` | Paginate all workflows. |
| `GET` | `/workflows/:workflowId` | Load one workflow into the canvas. |
| `PATCH` / `PUT` | `/workflows/:workflowId` | Save edits, rename, or change status. |
| `DELETE` | `/workflows/:workflowId` | Delete a workflow permanently. |
| `POST` | `/genAI/chat` with `workflowName` | Run a saved workflow against a chat message. |

## Canonical workflow shape

Use this flat shape in the UI. Nodes are identified by their unique `name`; edges and variable expressions use that exact name.

```ts
type Position = { x: number; y: number };

type WorkflowNode = {
  name: string;
  type: 'input' | 'agent' | 'tool' | 'condition' | 'output';
  position: Position;

  // Agent node fields
  agentType?: 'prompt_agent' | 'function_call_agent' | 'sandbox_agent';
  provider?: 'groq' | 'mistral';
  model?: string;
  prompt?: string;
  tools?: string[];

  // Tool node fields
  tool?: 'knowledge_base_search' | 'knowledge_base_document_search' | 'rag' | 'http' | 'mcp';
  input?: Record<string, unknown>;
  settings?: Record<string, unknown>;

  // Condition node field
  expression?: string;

  // Output node field
  value?: string;
};

type WorkflowEdge = {
  from: string;
  to: string;
  when?: string;
};

type Workflow = {
  workflowId: string;
  ownerId: string;
  name: string;
  description?: string;
  status: 'draft' | 'published';
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
};
```

`position` must always be preserved when the graph is saved. It is presentation data for the canvas and has no execution effect.

## Node types

| Node type | Required fields | Purpose |
| --- | --- | --- |
| `input` | `name`, `type`, `position` | The one entry point for a workflow. |
| `agent` | `name`, `type`, `position`, `agentType` | An AI reasoning/model node. |
| `tool` | `name`, `type`, `position`, `tool` | A deterministic or external capability. |
| `condition` | `name`, `type`, `position`, `expression` | A future execution branch. |
| `output` | `name`, `type`, `position` | Optional final workflow response. If `value` is omitted, it dynamically takes the last ran node's response. |

## Agent types

Agent type is different from a specialised task such as RAG. It describes **how the agent operates**.

| `agentType` | Use it for | Tool behavior |
| --- | --- | --- |
| `prompt_agent` | Rewrite, summarize, classify, answer, or any prompt-only task | Does not autonomously invoke tools. |
| `function_call_agent` | An agent that may select from allowed tool nodes | Runtime will expose only IDs listed in `tools`. |
| `sandbox_agent` | Future isolated code/data task execution | Stored now, intentionally not executable yet. |

For a simple RAG workflow, use a `prompt_agent` for rewriting and answering, plus an explicit `knowledge_base_search` tool. A future all-in-one `rag` tool is included in the palette but has not been implemented as an executor.

## Tool types

| `tool` | Status | Required configuration |
| --- | --- | --- |
| `knowledge_base_search` | Planned runtime integration | `input.query`, optional `input.topK` |
| `knowledge_base_document_search` | Planned runtime integration | `input.documentId`, `input.query`, optional `input.topK` |
| `rag` | Reserved | Future RAG-specific configuration |
| `http` | Reserved | `settings.connectionId`, `settings.operationId` |
| `mcp` | Reserved | `settings.connectionId`, `settings.toolName` |

Never put a server URL with credentials, API key, OAuth token, or secret in `settings` or any other workflow field. `connectionId` will later reference a server-side, workspace-scoped connection.

## 1. Load builder options

`GET /workflows/registry`

Load it when the workflow builder opens. Use it to construct the draggable palette and configuration dropdowns instead of hard-coding values.

```json
{
  "nodeTypes": [
    { "type": "input", "label": "Chat Input", "category": "flow" },
    { "type": "agent", "label": "Agent", "category": "ai" },
    { "type": "tool", "label": "Tool", "category": "tools" },
    { "type": "condition", "label": "Condition", "category": "flow" },
    { "type": "output", "label": "Output", "category": "flow" }
  ],
  "agentTypes": [
    { "type": "prompt_agent", "description": "Runs a configured prompt against the selected model." },
    { "type": "function_call_agent", "description": "Lets the model select and call approved tool nodes." },
    { "type": "sandbox_agent", "description": "Reserved for isolated code or task execution." }
  ],
  "toolTypes": [
    { "type": "knowledge_base_search", "kind": "built_in" },
    { "type": "knowledge_base_document_search", "kind": "built_in" },
    { "type": "rag", "kind": "planned" },
    { "type": "http", "kind": "configured" },
    { "type": "mcp", "kind": "configured" }
  ]
}
```

## 2. Create a workflow

`POST /workflows`

Until Auth0 is added, `ownerId` is required. It will be removed from the frontend request once the backend derives it from the Auth0 access token.

```ts
const response = await fetch(`${API_URL}/workflows`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ownerId: currentUserId, ...workflow }),
});

if (!response.ok) throw new Error(await response.text());
const saved: Workflow = await response.json();
```

Use this payload. It is your supplied format with the required `agentType` fields added:

```json
{
  "ownerId": "current-user-id",
  "name": "Grounded knowledge assistant",
  "description": "Rewrite, search the knowledge base, then answer from retrieved sources.",
  "version": 1,
  "nodes": [
    {
      "name": "Question",
      "type": "input",
      "position": { "x": 0, "y": 120 }
    },
    {
      "name": "Rewrite question",
      "type": "agent",
      "agentType": "prompt_agent",
      "position": { "x": 280, "y": 120 },
      "provider": "groq",
      "model": "llama-3.1-8b-instant",
      "prompt": "Rewrite the user's question as a short, standalone search query. Return JSON: {\\\"query\\\": string}.\\n\\nQuestion: {{Question.output.message}}"
    },
    {
      "name": "Search knowledge base",
      "type": "tool",
      "position": { "x": 560, "y": 120 },
      "tool": "knowledge_base_search",
      "input": {
        "query": "{{Rewrite question.output.query}}",
        "topK": 5
      }
    },
    {
      "name": "Grounded answer",
      "type": "agent",
      "agentType": "prompt_agent",
      "position": { "x": 840, "y": 120 },
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "prompt": "Answer only from these sources:\\n{{Search knowledge base.output.results}}\\n\\nQuestion: {{Question.output.message}}\\nInclude source titles."
    },
  ],
  "edges": [
    { "from": "Question", "to": "Rewrite question" },
    { "from": "Rewrite question", "to": "Search knowledge base" },
    { "from": "Search knowledge base", "to": "Grounded answer" }
  ]
}
```

Successful response: `201 Created` with the persisted `Workflow`. The backend adds `workflowId`, `status: "draft"`, and timestamps.

## 3. List workflows

`GET /workflows` returns all workflows sorted by newest `updatedAt` first.

```ts
const workflows: Workflow[] = await fetch(`${API_URL}/workflows`).then((response) => response.json());
```

Optional filters:

```text
GET /workflows?ownerId=current-user-id
GET /workflows?skip=0&limit=20
GET /workflows?ownerId=current-user-id&skip=20&limit=20
```

- `ownerId` is optional.
- `skip` is optional, defaults to `0`, and must be a non-negative integer.
- `limit` is optional and must be a positive integer.
- If `limit` is omitted, every workflow after `skip` is returned.

The response is always `Workflow[]`; it does not wrap results in a pagination object.

## 4. Load one workflow

`GET /workflows/:workflowId`

```ts
const workflow: Workflow = await fetch(`${API_URL}/workflows/${workflowId}`).then(async (response) => {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
});
```

Map every node directly to the canvas, retaining `name`, `position`, and all node-specific fields. Do not create a second nested `config` object.

## 5. Save a workflow safely

`PATCH /workflows/:workflowId`

Send `nodes` and `edges` together whenever the graph changes. Include the currently loaded `version` to prevent accidentally overwriting another editor's changes.

```ts
const response = await fetch(`${API_URL}/workflows/${workflow.workflowId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: workflow.version,
    name: workflow.name,
    description: workflow.description,
    nodes: workflow.nodes,
    edges: workflow.edges,
  }),
});

if (response.status === 409) {
  // Reload the workflow and let the user resolve the changed version.
}
```

Every successful update increments `version`. Replace the frontend's local workflow with the returned response.

Publish or unpublish without changing the graph:

```json
{ "version": 3, "status": "published" }
```

## 6. Delete a workflow

`DELETE /workflows/:workflowId`

Delete a workflow at any time.

```ts
const response = await fetch(`${API_URL}/workflows/${workflowId}`, {
  method: 'DELETE',
});

if (!response.ok) throw new Error(await response.text());
const result = await response.json();
// Returns: { message: "Workflow deleted successfully", workflowId: "...", deletedWorkflow: { ... } }
```

## 7. Chat with a workflow

`POST /genAI/chat`

Pass `workflowName` to select workflow execution. Do not send `agent` at the same time; `workflowName` takes precedence over the legacy direct-agent behavior.

```ts
const response = await fetch(`${API_URL}/genAI/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflowName: 'Grounded knowledge assistant',
    // Required only while authentication is not connected. It disambiguates same-name workflows.
    workflowOwnerId: currentUserId,
    messages: [
      { role: 'user', content: 'What is our remote work policy?' },
    ],
  }),
});

if (!response.ok) throw new Error(await response.text());
const run = await response.json();
```

Request shape:

```ts
type WorkflowChatRequest = {
  workflowName: string;
  workflowOwnerId?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: false;
};
```

`workflowName` is matched exactly. If same-name workflows exist and `workflowOwnerId` is omitted, the server returns `409` and the frontend must pass the owner ID. When Auth0 is added, the backend will use the authenticated workspace/user context instead.

Workflow streaming is not available in this initial endpoint. Do not set `stream: true` when sending `workflowName`.

### Workflow chat response

The response is stable across all workflow designs. Use `response.message` for the main chat bubble, `response.citations` for source cards, `response.finalNode` to identify the automatically selected terminal result, `response.outputs` for workflow-specific UI, and `trace` for a developer/test-run panel.

```ts
type WorkflowChatResponse = {
  workflow: {
    workflowId: string;
    name: string;
    version: number;
  };
  run: {
    runId: string;
    status: 'completed';
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  response: {
    message: string;
    finalNode: { name: string; type: string };
    outputs: Record<string, unknown>;
    citations: Array<{
      documentId: string;
      title?: string;
      excerpt: string;
      score: number;
    }>;
  };
  trace: Array<{
    nodeName: string;
    nodeType: 'input' | 'agent' | 'tool' | 'condition' | 'output';
    status: 'completed';
    durationMs: number;
    output: Record<string, unknown>;
  }>;
};
```

Example response for the grounded workflow:

```json
{
  "workflow": {
    "workflowId": "e1f4b412-1a18-4ddd-80a5-527013d13ee4",
    "name": "Grounded knowledge assistant",
    "version": 1
  },
  "run": {
    "runId": "8e97f034-febe-47bd-ae88-e1fe0bcb50b1",
    "status": "completed",
    "startedAt": "2026-10-04T10:20:15.491Z",
    "completedAt": "2026-10-04T10:20:17.018Z",
    "durationMs": 1527
  },
  "response": {
    "message": "Employees may work remotely up to three days per week.",
    "finalNode": { "name": "Grounded answer", "type": "agent" },
    "outputs": {
      "Grounded answer": { "answer": "Employees may work remotely up to three days per week." }
    },
    "citations": [
      {
        "documentId": "doc-123",
        "title": "Remote Work Policy",
        "excerpt": "Employees may work remotely up to three days per week...",
        "score": 0.89
      }
    ]
  },
  "trace": [
    { "nodeName": "Question", "nodeType": "input", "status": "completed", "durationMs": 0, "output": { "message": "What is our remote work policy?" } },
    { "nodeName": "Rewrite question", "nodeType": "agent", "status": "completed", "durationMs": 402, "output": { "query": "remote work policy" } },
    { "nodeName": "Search knowledge base", "nodeType": "tool", "status": "completed", "durationMs": 110, "output": { "results": [] } },
    { "nodeName": "Grounded answer", "nodeType": "agent", "status": "completed", "durationMs": 1004, "output": { "answer": "Employees may work remotely up to three days per week." } }
  ]
}
```

The trace contains the complete resolved node output and should be shown only in a workflow test/debug screen, not in the normal end-user chat interface.

### Automatic final response selection

The frontend does not need to add an Output node. The server selects the final response after a workflow finishes:

1. A terminal `output` node, if the graph includes one.
2. Otherwise, a terminal `agent` node.
3. Otherwise, the first terminal node, such as a tool node.

For an agent, the server uses `output.answer` when present and falls back to `output.content`. This makes the final `Grounded answer` agent in the example above the chat response automatically.

When using an Output node:
- If `value` is omitted or empty, the Output node dynamically takes the response of the last ran node connected to it.
- You can also specify an explicit template or text in `value`:

```json
{
  "name": "Custom response",
  "type": "output",
  "position": { "x": 1120, "y": 120 },
  "value": "{{Grounded answer.output.answer}}"
}
```

### Runtime support matrix

| Node configuration | Current execution behavior |
| --- | --- |
| `agentType: "prompt_agent"` | Executes the rendered `prompt` using the node's Groq/Mistral provider and model. |
| `agentType: "function_call_agent"` | Executes its rendered prompt as a model node. Autonomous model-selected tool calls are not enabled yet. Use explicit tool nodes in the graph. |
| `agentType: "sandbox_agent"` | Returns `501 Not Implemented`. |
| `tool: "knowledge_base_search"` | Executes semantic search using the existing knowledge-base service and adds citations. |
| `tool: "knowledge_base_document_search"`, `rag`, `http`, `mcp` | Returns `501 Not Implemented`. |
| `condition` | Returns `501 Not Implemented`. |

### Template variables during execution

Use a node's exact name followed by `.output`:

```text
{{Question.output.message}}
{{Rewrite question.output.query}}
{{Search knowledge base.output.results}}
{{Grounded answer.output.answer}}
```

If a template is the complete value, such as `"{{Search knowledge base.output.results}}"`, it resolves to the original array/object. Inside a longer prompt, arrays and objects are JSON-serialized.

## Graph validation enforced by the API

The canvas should prevent these before save; the backend validates them again.

- Node names must be unique and non-empty.
- Every node needs a numeric `position.x` and `position.y`.
- There must be exactly one `input` node and at least one node after it. Output nodes are optional.
- An agent requires `agentType`.
- A tool requires `tool`.
- A condition requires `expression`.
- An output `value` is optional; if omitted, it dynamically takes the last ran node's response.
- Every edge must reference existing node names.
- Input nodes cannot have incoming edges; output nodes cannot have outgoing edges.
- Self-links, duplicate links, disconnected nodes, and cycles are rejected.
- Save the whole graph as a directed acyclic graph (DAG).

## Error responses

| HTTP status | Meaning | Frontend handling |
| --- | --- | --- |
| `400` | Invalid graph or query parameters | Highlight the affected field/node/edge using `message`. |
| `404` | No workflow exists for `workflowId` | Return to the workflow list. |
| `409` | The version is stale | Reload before allowing another save. |
| `409` | More than one workflow has the supplied name | Add `workflowOwnerId` to the workflow-chat request. |
| `501` | A saved node has no runtime executor yet | Show the node/runtime capability message in the test panel. |

Example validation response:

```json
{
  "statusCode": 400,
  "message": "Duplicate node name: Grounded answer",
  "error": "Bad Request"
}
```

## MCP and sandbox UI behavior

Show `mcp`, `http`, and `sandbox_agent` in the builder now, but mark them as unavailable for test runs until their runtime is implemented. They can be safely saved in workflow JSON today.

For a future MCP node, use only a server-side connection reference:

```json
{
  "name": "CRM lookup",
  "type": "tool",
  "position": { "x": 560, "y": 320 },
  "tool": "mcp",
  "settings": {
    "connectionId": "crm-production",
    "toolName": "find_customer"
  },
  "input": {
    "email": "{{Question.output.message}}"
  }
}
```

## Existing model endpoint

Use `GET /genAI/models` to populate `provider` and `model` selectors for Agent nodes. The frontend should save the selected values on the node itself, exactly as shown above.
