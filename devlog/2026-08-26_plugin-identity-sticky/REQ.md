# Requirement: native mode disappears after switching models in the omp TUI

User report: in a `bili omp` TUI session, after switching models (GLM chat → qwen responses), the
model fell back to wire mode (the model pasted raw acp_status output into the conversation, and
"native mode disappeared").

## Reproduction (full-fidelity launcher TUI + dual-protocol mock)
- New session, chat protocol, send a message: the identity register is consumed, plugin mode ✓.
- Switch to a responses model (same conversation, new session): injectTool=true → wire ✗.

## Root cause
`consumePluginRegisterFor` treats an identity registration as delete-on-read: the first request
consumes it and the registration is deleted. Switching models changes the session key
(protocol|upstream|apiKey|conversation) → a new session → the queue is already empty → wire mode.
The #162 semantics should have been "any request for that conversation binds on arrival."

## Fix
An identity registration is sticky for its conversation: consuming it keeps the entry and refreshes
the LRU order, reusing the existing `MAX_PENDING_REGISTERS=64` capacity limit.
