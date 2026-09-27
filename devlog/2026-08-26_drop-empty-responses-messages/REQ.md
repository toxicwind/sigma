# REQ — drop whitespace-only Responses message items at ingress

## User request

The user saw a large number of 1-token empty messages in their omp `--resume 01a03da3-d8b9-7000-8637-5d82777129fe` session (they found them while the model was enumerating the message list itself). The chain of questions:

1. Where do these empty messages come from?
2. Are we (bili) inserting them dynamically?
3. Does pi do this too? Is it an SGLang protocol issue, a client issue, or our issue?
4. Messages are JSON, are they not? Could something be splitting on carriage returns?
5. Should it be fixed together with the earlier PR (#257, the omp native plugin)?

## Acceptance

- Identify the source of the empty messages and the layer responsible.
- Fix: empty messages are dropped before projection and are never tagged or numbered.
- Messages carrying real content are unaffected, even when most of the content is whitespace.
- The full test suite, typecheck, and build all stay green.
- A standalone PR (not bundled with #257).

## Outcome

- Root cause: the Responses wire format has no way to express mixed content, so omp flattens the model's per-turn text blocks into individual message items. The model (following the SGLang habit) emits `\n\n` before a tool call, which becomes its own empty message. bili then stamps a 42-character acp tag plus a number onto that 1-token whitespace, which inflates it 10x, adds reference noise, and becomes sticky: the tag turns the whitespace into "non-empty" text that omp replays forever. pi is unaffected, because the anthropic wire format's block array can hold a whitespace block inside a mixed message as-is.
- Fix: `dropWhitespaceResponsesMessages` strips the tag, checks for whitespace, and deletes the item before `prepareResponses` projects it. A tag that wraps real content is never deleted.
