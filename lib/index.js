/**
 * dsh-connect-modelscope — Host 半部分。
 *
 * 把 ModelScope（魔搭）的模型接入 DeepSeek Harness：插件自己向 `llm` 服务注册
 * 一个 `modelscope` provider，模型目录在挂载时从 `GET /v1/models` 拉一次，密钥
 * 存进 DSH 的凭据服务（引用名 `MODELSCOPE_API_KEY`）。用户只需要在设置页的
 * 插件卡片里粘贴一次 API Key。
 *
 * 为什么不用手写 `llm-pi-ai` 配置：那份 YAML 要自己写 baseURL、模型清单、
 * 每个模型的 compat 和推理档位，换账号还得整段重来。插件把这一步固化下来，
 * 密钥走凭据服务，卡片里保存后下一次请求就生效。
 *
 * @module dsh-connect-modelscope
 */

import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { API_KEY_REF, createKeyStore, maskKey } from './key-store.js'
import { errorMessage, registerRoutes } from './routes.js'
import {
  CURATED_MODELS,
  DEFAULT_BASE_URL,
  PREFERRED_MODEL_ID,
  describeUnknown,
  isChatModel,
  mergeCatalog,
  toPiModel,
} from './models.js'

/** Loader 条目 id，同时是 `/plugins/<id>/…` 路由前缀。 */
export const name = 'dsh-connect-modelscope'

/** 需要宿主提供的能力。`webServer` 走可选注入，缺了也不影响聊天。 */
export const inject = ['llm', 'settings']

/** provider 路由 id。刻意沿用 `modelscope`：手写配置迁移过来时模型选择不变。 */
export const MODELSCOPE_PROVIDER = 'modelscope'

/** provider 在模型选择器里显示的名字。 */
export const MODELSCOPE_PROVIDER_DISPLAY_NAME = 'ModelScope'

/** 兜底的设置命名空间（正常情况下从 Loader 条目 id 推导）。 */
export const MODELSCOPE_SETTINGS_NS = name

/** 拉模型目录的超时。 */
const CATALOG_TIMEOUT_MS = 15_000

/** 「测试连接」发一次极小请求的超时。 */
const TEST_TIMEOUT_MS = 60_000

/** 流式请求的空闲超时。 */
const STREAM_IDLE_TIMEOUT_MS = 300_000

/** 请求体上限：只有一个小 JSON，64KB 足够。 */
const BODY_LIMIT = 65_536

/** pi-ai 的附件预算，与参考实现保持一致。 */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImageBytes: 20_971_520,
  requestImagePixelBudget: 4_194_304,
  requestImageMaxBytes: 1_048_576,
}

/** 插件设置。字段名保持英文，描述走中文。 */
export const Config = z.object({
  baseURL: z
    .string()
    .default(DEFAULT_BASE_URL)
    .description('ModelScope 的 OpenAI 兼容端点。换私有网关时才需要改。'),
  refreshOnStart: z.boolean().default(true).description('启动时拉取一次模型列表。拉不到就退回内置精选，不影响使用。'),
  extraModels: z
    .array(z.string())
    .default([])
    .description('额外显示的模型 id。默认会被过滤掉的模型（例如自建图像模型）可以写在这里。'),
})

/**
 * 从 ctx 推导设置命名空间。
 * @param {object} ctx Cordis 上下文。
 * @returns {string} 设置命名空间。
 */
export function settingsNamespaceOf(ctx) {
  const id = ctx?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : MODELSCOPE_SETTINGS_NS
}

/**
 * 规整端点：去掉结尾斜杠，缺协议时补 https。
 * @param {unknown} value 配置值。
 * @returns {string} 端点。
 */
export function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withScheme = raw === '' ? DEFAULT_BASE_URL : /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * 用指定密钥拉一次上游模型目录。
 * @param {object} options 选项。
 * @param {string} options.baseURL 端点。
 * @param {string} options.apiKey 密钥。
 * @returns {Promise<Array<string>>} 聊天模型 id。
 */
export async function fetchModelIds({ baseURL, apiKey }) {
  const url = `${baseURL}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body?.data) ? body.data : []
  return rows
    .map((row) => (typeof row?.id === 'string' ? row.id : ''))
    .filter((id) => isChatModel(id))
}

/**
 * 发一次极小 chat 请求，验证密钥和模型都能用。
 * @param {object} options 选项。
 * @param {string} options.baseURL 端点。
 * @param {string} options.apiKey 密钥。
 * @param {string} options.model 模型 id。
 * @returns {Promise<{model: string, latencyMs: number, sample: string}>} 探测结果。
 */
export async function probeChat({ baseURL, apiKey, model }) {
  const startedAt = Date.now()
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 64,
      stream: false,
    }),
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} · ${text.slice(0, 300)}`)
  let sample = ''
  try {
    const body = JSON.parse(text)
    const message = body?.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    // 推理模型可能只回 reasoning_content（content 被 max_tokens 截空），两者取其一。
    const reasoning = typeof message?.reasoning_content === 'string' ? message.reasoning_content : ''
    sample = (content || reasoning).slice(0, 120) || '(空回复)'
  } catch {
    sample = '(响应不是 JSON)'
  }
  return { model, latencyMs: Date.now() - startedAt, sample }
}

/**
 * 组装 PiAiAdapter。
 *
 * 密钥每次请求现取（`resolveApiKey`），所以卡片里保存后不需要重启，也不需要
 * 重新注册 provider。
 * @param {object} options 选项。
 * @param {() => Array<object>} options.catalog 当前模型目录。
 * @param {() => string} options.baseURL 当前端点。
 * @param {() => Promise<string|undefined>} options.resolveApiKey 取密钥。
 * @returns {{adapter: PiAiAdapter, profiles: () => Map<string, object>, invalidate: () => void}} 适配器与刷新函数。
 */
export function createModelScopeAdapter(options) {
  const { catalog, baseURL, resolveApiKey } = options
  const providerId = MODELSCOPE_PROVIDER
  const providerName = MODELSCOPE_PROVIDER_DISPLAY_NAME
  const api = openAICompletionsApi()

  /** 用当前目录生成描述符。 */
  const buildModels = () => catalog().map((info) => toPiModel(info, baseURL(), providerId))

  const provider = {
    ...createProvider({
      id: providerId,
      name: providerName,
      auth: {
        apiKey: {
          name: 'ModelScope API Key',
          async resolve() {
            const value = await resolveApiKey()
            return value === undefined || value === '' ? { auth: {} } : { auth: { apiKey: value }, source: 'ModelScope API Key' }
          },
        },
      },
      models: buildModels(),
      api,
    }),
    getModels: () => buildModels(),
  }

  /** 生成一份 profile；`invalidate()` 会换掉它，让宿主丢弃缓存。 */
  const buildProfiles = () =>
    new Map([
      [
        providerId,
        {
          provider: providerId,
          displayName: providerName,
          streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
          retryPolicy: resolveRetryPolicy(undefined, `${name} retryPolicy`),
          configuredMaxTokens: new Map(),
          modelErrors: new Map(),
          ...REQUEST_IMAGE_BUDGETS,
          piProvider: provider,
        },
      ],
    ])

  let profiles = buildProfiles()

  return {
    adapter: new PiAiAdapter({
      profiles: () => profiles,
      // 密钥由 RHS 的 resolveApiKey 提供，pi-ai 这一层不需要账号仓库。
      auth: {
        credentials: {
          async read() {},
          async list() {
            return []
          },
          async modify() {},
        },
        authContext: {},
      },
      resolveApiKey: async () => (await resolveApiKey()) ?? '',
    }),
    profiles: () => profiles,
    invalidate: () => {
      profiles = buildProfiles()
    },
  }
}

/**
 * 插件入口。
 * @param {object} ctx Cordis 上下文。
 * @param {object} config 设置。
 */
export function apply(ctx, config = {}) {
  const settingsNs = settingsNamespaceOf(ctx)

  /** 当前端点。 */
  const baseUrl = () => normalizeBaseUrl(config.baseURL)

  /** 额外的模型 id（配置里写的那些）。 */
  const extraModelIds = () => {
    const raw = Array.isArray(config.extraModels) ? config.extraModels : []
    return raw.map((id) => String(id ?? '').trim()).filter((id) => id !== '')
  }

  /** 凭据服务可能比插件晚注册，所以每次现取。 */
  const credentialsService = () => {
    try {
      return ctx.get?.('credentials') ?? undefined
    } catch {
      return undefined
    }
  }

  const keyStore = createKeyStore({ credentials: credentialsService, env: process.env, ref: API_KEY_REF })

  /** 当前模型目录：先给内置精选，拉取成功后换成线上目录。 */
  let catalog = CURATED_MODELS.map((model) => ({ ...model }))
  /** 目录状态。 */
  let catalogState = { live: false, fetchedAt: 0, reason: '尚未拉取' }
  /** 注册状态。 */
  let registered = false
  let lastError
  /** @type {object|undefined} */
  let adapter
  let releaseAdapter
  let releaseDirectory
  let disposed = false
  let refreshInFlight

  /**
   * 拉线上目录并更新 `catalog`。
   * @param {object} [options] 选项。
   * @param {string} [options.apiKey] 指定密钥（保存后校验用），默认从凭据服务取。
   * @returns {Promise<{ok: boolean, reason?: string}>} 拉取结果。
   */
  async function refreshCatalog(options = {}) {
    const explicit = typeof options.apiKey === 'string' && options.apiKey !== '' ? options.apiKey : undefined
    const key = explicit === undefined ? await keyStore.resolve() : { value: explicit, source: 'explicit' }
    if (key === undefined) {
      catalog = mergeCatalog([])
      catalogState = { live: false, fetchedAt: 0, reason: '还没有配置 API Key' }
      return { ok: false, reason: '还没有配置 API Key' }
    }
    try {
      const ids = await fetchModelIds({ baseURL: baseUrl(), apiKey: key.value })
      const merged = mergeCatalog(ids)
      for (const id of extraModelIds()) {
        if (!merged.some((model) => model.id === id)) merged.unshift(describeUnknown(id))
      }
      catalog = merged
      catalogState = { live: true, fetchedAt: Date.now(), reason: undefined }
      return { ok: true }
    } catch (error) {
      const reason = errorMessage(error)
      // 拉不到目录时保留内置精选：用户至少还能选到 V4.1 Flash。
      catalog = mergeCatalog([])
      catalogState = { live: false, fetchedAt: 0, reason }
      return { ok: false, reason }
    }
  }

  /**
   * 串行化的目录刷新：卡片连点两次不会打两发请求。
   * @param {object} [options] 选项。
   * @returns {Promise<{ok: boolean, reason?: string}>} 结果。
   */
  function refreshCatalogOnce(options = {}) {
    if (refreshInFlight !== undefined) return refreshInFlight
    refreshInFlight = refreshCatalog(options).finally(() => {
      refreshInFlight = undefined
    })
    return refreshInFlight
  }

  /**
   * 让宿主重新读 provider 的模型表。
   * @returns {void}
   */
  function emitCatalogUpdate() {
    adapter?.invalidate?.()
    try {
      ctx.emit?.('llm/adapters-updated')
    } catch {
      /* 宿主不接受事件也不影响已经注册的 provider */
    }
  }

  /**
   * 注册 provider（只注册一次）。
   * @returns {void}
   */
  function registerProvider() {
    if (registered || disposed) return
    try {
      adapter = createModelScopeAdapter({
        catalog: () => catalog,
        baseURL: baseUrl,
        resolveApiKey: async () => (await keyStore.resolve())?.value,
      })
      releaseAdapter = ctx.llm.registerAdapter([MODELSCOPE_PROVIDER], adapter.adapter)
      registered = true
      lastError = undefined
    } catch (error) {
      // 最常见的原因：profile 里还留着手写的 `llm-pi-ai` modelscope 段。
      lastError = `provider 注册失败：${errorMessage(error)}`
      ctx.logger?.warn?.(`${name}: ${lastError}`)
      return
    }
    try {
      releaseDirectory = ctx.llm.registerConfigurableProviders?.([
        {
          provider: MODELSCOPE_PROVIDER,
          displayName: MODELSCOPE_PROVIDER_DISPLAY_NAME,
          settingsNs,
          settingsPath: [],
          declared: false,
        },
      ])
    } catch (error) {
      ctx.logger?.warn?.(`${name}: configurable provider row failed: ${errorMessage(error)}`)
    }
    try {
      ctx.llm.registerModelDiscovery?.(settingsNs, async (request) => {
        if ((request?.provider ?? MODELSCOPE_PROVIDER) !== MODELSCOPE_PROVIDER) return []
        return catalog.map((model) => ({
          id: model.id,
          name: model.name,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          inputModalities: model.multimodal ? ['text', 'image'] : ['text'],
        }))
      })
    } catch (error) {
      ctx.logger?.warn?.(`${name}: model discovery registration failed: ${errorMessage(error)}`)
    }
  }

  /**
   * 当前状态快照，给卡片读。
   * @returns {Promise<object>} 状态。
   */
  async function buildStatus() {
    const key = await keyStore.resolve()
    return {
      provider: MODELSCOPE_PROVIDER,
      displayName: MODELSCOPE_PROVIDER_DISPLAY_NAME,
      baseURL: baseUrl(),
      key: {
        configured: key !== undefined,
        source: key?.source ?? 'none',
        masked: key === undefined ? '' : maskKey(key.value),
      },
      models: catalog.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        multimodal: model.multimodal,
        reasoning: model.reasoning,
      })),
      catalog: {
        live: catalogState.live,
        count: catalog.length,
        fetchedAt: catalogState.fetchedAt === 0 ? null : catalogState.fetchedAt,
        reason: catalogState.reason ?? null,
      },
      registered,
      error: lastError ?? null,
    }
  }

  /**
   * 挑一个用来测试的模型。
   * @param {unknown} requested 卡片指定的模型 id。
   * @returns {string|undefined} 模型 id。
   */
  function pickTestModel(requested) {
    if (typeof requested === 'string' && requested !== '' && catalog.some((model) => model.id === requested)) return requested
    if (catalog.some((model) => model.id === PREFERRED_MODEL_ID)) return PREFERRED_MODEL_ID
    return catalog[0]?.id
  }

  /**
   * 「测试连接」：打一发极小请求，验证密钥和模型都通。
   * @param {Record<string, unknown>} body 请求体。
   * @returns {Promise<object>} 探测结果。
   */
  async function testConnection(body = {}) {
    const key = await keyStore.resolve()
    if (key === undefined) throw Object.assign(new Error('还没有保存 API Key'), { status: 400 })
    const model = pickTestModel(body.model)
    if (model === undefined) throw Object.assign(new Error('模型目录是空的'), { status: 400 })
    return { ok: true, ...(await probeChat({ baseURL: baseUrl(), apiKey: key.value, model })) }
  }

  /** 卡片路由的依赖：路由只管 HTTP，业务逻辑都在这里。 */
  const routeDeps = {
    prefix: `/plugins/${name}`,
    status: buildStatus,
    saveKey: async (apiKey) => {
      const saved = await keyStore.save(apiKey)
      const fetched = await refreshCatalogOnce({ apiKey: saved.value })
      emitCatalogUpdate()
      return {
        ...(await buildStatus()),
        validation: fetched.ok ? { ok: true } : { ok: false, error: fetched.reason ?? '拉取模型目录失败；密钥已保存，可以稍后点「刷新模型」重试。' },
      }
    },
    forgetKey: async () => {
      await keyStore.forget()
      await refreshCatalogOnce()
      emitCatalogUpdate()
      return buildStatus()
    },
    refresh: async () => {
      const fetched = await refreshCatalogOnce()
      emitCatalogUpdate()
      return { ...(await buildStatus()), refresh: fetched }
    },
    test: testConnection,
  }

  // 先注册（用内置目录，界面立刻有模型可选），再拉线上目录。
  registerProvider()
  if (config.refreshOnStart !== false) {
    void refreshCatalogOnce().then(() => emitCatalogUpdate())
  }

  ctx.effect(() => () => {
    disposed = true
    try {
      releaseAdapter?.()
    } catch {
      /* ignore */
    }
    try {
      releaseDirectory?.()
    } catch {
      /* ignore */
    }
  })

  ctx.inject(['webServer'], (webCtx) => registerRoutes(webCtx, routeDeps))
}

export default { name, inject, Config, apply, settingsNamespaceOf }