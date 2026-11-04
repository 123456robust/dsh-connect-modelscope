# dsh-connect-modelscope

Connect [ModelScope](https://modelscope.cn) models to DeepSeek Harness. **Paste one API key**: the plugin registers the `modelscope` provider itself, fetches the model catalog itself, and handles ModelScope's DeepSeek-style `thinking` parameter. No YAML, no restart, under 100 KB.

## Why

A hand-written `llm-pi-ai` provider needs a base URL, dozens of model ids, per-model `compat` flags and reasoning levels — and you redo it for every account. This plugin fixes that:

- the key lives in the DSH credential store under `MODELSCOPE_API_KEY`, never in a config file;
- it takes effect on the next request, no restart;
- the catalog comes from `GET /v1/models`, with image-generation / embedding / speech endpoints filtered out;
- if the fetch fails it falls back to a built-in shortlist (including `deepseek-ai/DeepSeek-V4.1-Flash-1017`), so the model picker is never empty.

## Install

Install the bundle from **Settings → Plugins** with:

```
github:123456robust/dsh-connect-modelscope
```

Or clone the repo and pick its root directory in the plugin page. Restart DSH once after the first bundle install.

## Use

1. Open **Settings → Plugins** and find the **ModelScope** card;
2. Create an API key at [ModelScope access tokens](https://modelscope.cn/my/myaccesstoken) (`ms-…`);
3. Paste it and press **Save & verify**. The card then shows the key source, endpoint, model count and the model list;
4. Pick `ModelScope` in the model picker.

Other buttons: **Refresh models** (re-fetch `/v1/models`), **Test connection** (a tiny `max_tokens: 8` request), **Forget key** (remove `MODELSCOPE_API_KEY` from the credential store).

## Where the key lives

| Location | Notes |
| --- | --- |
| `ctx.credentials` (`MODELSCOPE_API_KEY`) | what the card saves; managed by DSH, owner-only |
| env `MODELSCOPE_API_KEY` | fallback when nothing is saved |
| process memory | fallback when the host has no credential service; gone on restart |

Resolution order: credential store → memory → environment. The reference name matches the one used by hand-written `apiKeyEnv` configs, so an existing key keeps working.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `baseURL` | `https://api-inference.modelscope.cn/v1` | OpenAI-compatible endpoint |
| `refreshOnStart` | `true` | fetch the catalog once on start |
| `extraModels` | `[]` | extra model ids to show (ones filtered out by default) |

## Migrating from a hand-written provider

If you previously hand-wrote `llm-pi-ai.config.providers.modelscope`, **delete that block**. Otherwise the provider is registered twice and the card reports a registration failure. Keep `agent-default-model` on `provider: modelscope` — it keeps working.

## Model metadata

`/v1/models` returns ids only. The plugin ships a table of 35 chat models; unknown ids get conservative defaults (128K context, 16K output, text-only).

## Development

```bash
npm test   # offline: catalog filtering, metadata merge, key precedence, route guards
```

## License

MIT