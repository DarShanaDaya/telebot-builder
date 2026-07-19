# Flow Builder and Runtime Guide

This document describes how flows are designed in the visual builder, saved, validated, published, and executed by Telegram bots.

## Overview

Telebot Builder uses a React Flow canvas for authoring and a transport-agnostic Node.js runtime for execution.

```text
Palette -> React Flow canvas -> draft flow JSON -> validation -> published flow JSON
                                                           |
Telegram update -> runtime session -> node executor -> next edge / wait / end
```

A flow consists of:

- `nodes`: visual and executable steps
- `edges`: connections between steps
- `viewport`: optional canvas zoom and position

Each node has an application type in `data.nodeType` in the editor. Stored flows use the node type in `node.type`.

## Authoring a flow

1. Drag a node from the palette or click a palette item.
2. A Start node is automatically added when required.
3. Select a node to edit its properties in the inspector.
4. Drag from an output pin to the target node's input pin.
5. Use **Validate** before saving or publishing.
6. Use **Save draft** to save work without changing the live bot.
7. Use **Publish** to make the flow live.

Nodes can be moved, selected, deleted, and connected using the normal React Flow interactions. Delete a selected node with Backspace or Delete.

## Flow JSON

A minimal flow looks like this:

```json
{
  "nodes": [
    { "id": "start-1", "type": "start", "position": { "x": 80, "y": 140 }, "data": {} },
    { "id": "message-1", "type": "message", "position": { "x": 360, "y": 140 }, "data": { "text": "Hello" } }
  ],
  "edges": [
    { "id": "e1", "source": "start-1", "target": "message-1", "sourceHandle": "out" }
  ]
}
```

Edges are stored with only stable fields: `id`, `source`, `target`, `sourceHandle`, and `targetHandle`. Editor-only styling is added when the flow is loaded.

## Output handles

Every normal node has an `out` source handle unless it is an ending or branching/wait node. Branching nodes use named handles:

| Node | Handles |
| --- | --- |
| Buttons | `btn-<button id>` for non-link buttons |
| Condition | `true`, `false` |
| Input | `out`, `cancel` |
| HTTP | `success`, `error` |
| AI Reply | `out`, `error` |
| Switch | `case-0`, `case-1`, ..., `default` |
| Loop | `iterate`, `done` |
| Function | `success`, `error` |
| Parallel | `branch-<branch id>` |
| Webhook | `triggered`, `error` |

Link buttons intentionally do not get an output handle because Telegram opens their URL directly. Button callbacks use the payload `btn:<node id>:<button id>` and resume the flow from the matching named edge.

### Forwarding button and input values

Non-link buttons can have a **Value** separate from their visible label. When a user selects one, its value is saved in the Buttons node's **Save selected value to** variable (default: `button_value`) before the connected branch runs. For example, a label of `Standard plan` with value `standard` can be used in every following field as `{{button_value}}`. If no value is supplied, the button label is used for compatibility with existing flows.

The most recent selection is also always available as `{{last_button}}` (label) and `{{last_button_value}}` (value). An Input node saves its accepted response to its configured variable and also exposes `{{last_input}}` / `{{last_input_value}}`. These are session variables, so they remain available to all later nodes, conditions, messages, HTTP requests, and AI prompts along the chosen flow path.

### Named-node references and picker

Every newly added node has a **Node name** (machine-readable and unique) and a **Node label** (friendly canvas text). Nodes that produce a value also retain it in their namespace. Use triple braces to reference that value: `{{{node_name.value_name}}}`. For example, a Buttons node named `plan_choice` whose button value name is `standard` is referenced as `{{{plan_choice.standard}}}`; an Input node named `contact` saving to `email` is referenced as `{{{contact.email}}}`.

The selected node's sidebar includes **Previous-node values**. It follows the incoming connections to show only values that can reach the selected node, grouped by node label and name. Click a token to copy the exact triple-brace reference. Button value names are configured alongside their labels and values.

### Pin alignment

Dynamic pins are rendered inside the visual row they represent. The `.row-handle` class centers a pin at `top: 50%` of that row. This is important: pins must not use fixed offsets based on node height because labels, descriptions, and dynamic options change the node height.

When adding a new row-based output:

1. Put the label and `Handle` inside a `position: relative` row.
2. Give the handle `className="row-handle"`.
3. Do not use hardcoded `top` offsets.
4. Add the handle ID to this document and to runtime edge selection.

## Runtime data flow

The runtime is in `server/src/runtime/engine.js` and node executors are in `server/src/runtime/actions.js`.

For each update:

1. The published flow is loaded.
2. A chat session is loaded or created.
3. Variables are restored from the session.
4. Telegram fields and variables are exposed through the template context.
5. The engine starts at Start for `/start` or a new idle conversation.
6. `runFrom` executes nodes in sequence.
7. An executor returns `{ next: nodeId }`, `{ wait: true }`, or `{ end: true }`.
8. The engine follows the edge matching the returned handle.
9. Session status, current node, pending wait, and variables are persisted.

The engine follows at most `MAX_STEPS` (currently 40) per update to protect against accidental infinite loops.

### Waiting nodes

Buttons and Input pause execution and persist the current node:

- Buttons use `awaiting_callback`; a callback resumes from `btn-<button id>`.
- Input uses `awaiting_input`; the next message is validated and resumes from `out`.
- `/cancel` clears the input wait and follows the `cancel` edge when present.

If a user types while waiting for a button, the configured nudge text is sent and the flow remains paused.

### Variables and templates

Variables are available in message text and node fields using the project template syntax. Runtime variables are live during a run, so values set by Set Variable, HTTP, Function, or AI nodes are available to following nodes. Telegram values include `chat_id`, `first_name`, `last_name`, `username`, and `language`.

Session persistence stores user variables and internal loop/parallel state in the session record. Internal state is removed from the public variable context when a session is loaded.

## Validation

Validation is implemented in `server/src/bots/validate.js`. It checks, among other things:

- required node and edge arrays
- valid edge source and target IDs
- a Start node
- reachable nodes
- required button/case/branch configuration
- valid branch handles

Validation errors must be fixed before publishing. Warnings do not necessarily block a draft but should be reviewed.

## Adding a node type

1. Add its definition and defaults in `client/src/builder/nodeDefs.js`.
2. Add its inspector fields in `client/src/builder/PropertiesPanel.jsx`.
3. Add its canvas renderer and handles in `client/src/builder/TbNode.jsx`.
4. Add its executor to `server/src/runtime/actions.js` and `EXECUTORS`.
5. Add validation rules in `server/src/bots/validate.js`.
6. Update the handle table in this document.
7. Add a runtime test in `server/test/selftest.js` or a focused test file.
8. Run both client build and server tests.

## Verification commands

From the repository root:

```bash
cd client
npm install
npm run build

cd ../server
npm install
npm test
```

`npm run build` verifies the React Flow editor compiles. The server self-test exercises publishing, callback handling, waits, and flow execution.

## Troubleshooting

### A pin appears at the node center or bottom

Check that the handle is inside the correct row and has `className="row-handle"`. Remove fixed `top` values. Confirm the row has `position: relative` and the CSS rule uses `top: 50% !important`.

### A button callback does not continue

Confirm the button has a stable `id`, is not a URL button, and that the edge source handle is exactly `btn-<button id>`. The runtime falls back to `out` only when no button-specific edge exists.

### A flow stops unexpectedly

Inspect the session status and runtime logs. A node may intentionally return a wait/end result, have no outgoing edge, reference a missing target, or exceed the 40-step loop guard.

### Draft changes are not live

Save draft only updates the draft. Publish is required before Telegram updates use the new flow.
