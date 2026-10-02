# REQ — `sigma dsh` launcher (deepseek-harness)

User request: support https://github.com/deepseek-ai/deepseek-harness by adding a `sigma dsh` launcher that sits alongside `sigma pi` / `sigma hermes` and the rest.

## Research findings (verified by hands-on testing)

- npm package `@deepseek-ai/dsh` (bin: `dsh`), built on the cordis composable-plugin architecture, home = `$DSH_HOME` or `~/.dsh`.
- Settings file: `$DSH_HOME/settings.yaml`, sectioned per plugin namespace (`llm-pi-ai:` / `llm-deepseek:` etc.). A document-level parse failure hard-crashes boot, while a bad section fails lazily and silently.
- **The default route `deepseek-official` does not go through the pi-ai catalog**: it has its own dedicated adapter, `dsh-llm-deepseek`, with the baseUrl resolution chain `config.baseURL ?? $DEEPSEEK_BASE_URL ?? https://api.deepseek.com` (config wins). Env redirection verified working.
- Custom providers: a `llm-pi-ai.providers.<route>` profile (`baseURL` field). pi-ai is a plain fetch with **no proxy/CA hook** → cert-MITM is not viable, so every `/sigma/` URL gets rewritten instead.
- agent-default-model hard-pins provider=deepseek-official + model=deepseek-v4-flash (headless profile).
- CLI: `dsh [--profile <name>] [args...]` passes through to the booted profile; `--profile headless "task"` works for a one-shot e2e.

## Design (final)

1. Built-in deepseek-official route: the launcher sets `DEEPSEEK_BASE_URL=<origin>/sigma/https://api.deepseek.com` (works with zero config; when the user's settings carry an `llm-deepseek.baseURL`, the rewritten config takes precedence and the env value automatically steps aside).
2. Custom providers in the user's settings.yaml: a persistent overlay at `~/.dsh-sigma` (same pattern as hermes) rewrites every `baseURL|baseUrl|base_url` value line by line, preserves CRLF, and shares profiles/credentials/sessions through symlinks; the real `~/.dsh` is never modified.
3. No catalog injection (it cannot be verified as taking effect, and it pollutes the config surface — cut).
4. There is no plugin API, so it is always wire mode.

## Drive-by fix

e2e surfaced a missing numeric field in the openai adapter's emitCompletion usage object: when the upstream sends no usage, `prompt_tokens: undefined` is dropped by JSON.stringify and the synthesized chunk is left with only `{"total_tokens":0}`; dsh's mapUsage computes NaN/undefined for the missing fields → a hard "non-JSON-serializable" crash. Fix: `?? 0` fallbacks (the anthropic/responses adapters already guard; openai was missed).
