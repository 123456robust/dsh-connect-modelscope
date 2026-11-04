/**
 * dsh-connect-modelscope — 模型目录与 pi-ai 模型描述符。
 *
 * ModelScope 的 `GET /v1/models` 只给 id，不给上下文窗口、输出上限、是否多模态
 * 这些元数据（`GET /v1/models/<id>` 直接 404）。所以这里维护一份内置表：
 * 表里有的模型用表里的数字，表里没有的模型给一组保守默认值。
 *
 * 这个文件不 import 任何宿主包，可以单独 `node -e` 跑，`scripts/selftest.mjs`
 * 直接测它。
 *
 * @module dsh-connect-modelscope/models
 */

/** ModelScope 的 OpenAI 兼容端点。 */
export const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1'

/** 未知模型的上下文窗口默认值（128k，最保守的一档）。 */
export const DEFAULT_CONTEXT_WINDOW = 131_072

/** 未知模型的单次输出上限默认值。 */
export const DEFAULT_MAX_TOKENS = 16_384

/** 只有图像产出的模型：列进来只会在聊天里报错。 */
const IMAGE_ONLY = /(^|[/_-])(qwen-image|flux|kolors|sdxl|stable-diffusion|wanx|seedream)/i

/** 其他非聊天端点：向量、重排、语音识别/合成、审核。 */
const NON_CHAT = /(embed|rerank|whisper|tts|asr|cosyvoice|sensevoice|vad|moderation|guard)/i

/** 支持推理档位的模型统一用这三档（上游对 xhigh/max 不保证）。 */
const REASONING_EFFORTS = ['low', 'medium', 'high']

/**
 * 内置模型表。
 *
 * 每行：`[id, 显示名, contextWindow, maxTokens, { image, reasoning }]`。
 * `contextWindow` / `maxTokens` 是尽力而为的估值：DSH 只用它算上下文占用
 * 和输出上限，填小一点比填大更安全。
 *
 * @type {Array<[string, string, number, number, { image?: boolean, reasoning?: boolean }]>}
 */
const MODEL_TABLE = [
  ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'DeepSeek V4.1 Flash 1017', 1_000_000, 65_536, { image: true, reasoning: true }],
  ['deepseek-ai/DeepSeek-V4.1-Flash', 'DeepSeek V4.1 Flash', 1_000_000, 65_536, { image: true, reasoning: true }],
  ['deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 1_000_000, 65_536, { reasoning: true }],
  ['deepseek-ai/DeepSeek-V4-Pro-0813', 'DeepSeek V4 Pro 0813', 1_000_000, 65_536, { reasoning: true }],
  ['deepseek-ai/DeepSeek-V4-Flash-0731', 'DeepSeek V4 Flash 0731', 1_000_000, 65_536, { reasoning: true }],
  ['Qwen/Qwen3.5-397B-A17B', 'Qwen3.5 397B A17B', 262_144, 32_768, { reasoning: true }],
  ['Qwen/Qwen3.5-122B-A10B', 'Qwen3.5 122B A10B', 262_144, 32_768, { reasoning: true }],
  ['Qwen/Qwen3.5-35B-A3B', 'Qwen3.5 35B A3B', 262_144, 32_768, { reasoning: true }],
  ['Qwen/Qwen3.5-27B', 'Qwen3.5 27B', 262_144, 32_768, { reasoning: true }],
  ['Qwen/Qwen3.8-Flash-Next', 'Qwen3.8 Flash Next', 262_144, 32_768, { reasoning: true }],
  ['Qwen/Qwen3.8-27B', 'Qwen3.8 27B', 262_144, 32_768, { reasoning: true }],
  ['ZhipuAI/GLM-5.2', 'GLM-5.2', 204_800, 32_768, { reasoning: true }],
  ['ZhipuAI/GLM-4.7-Flash', 'GLM-4.7 Flash', 131_072, 16_384, { reasoning: true }],
  ['MiniMax/MiniMax-M3', 'MiniMax M3', 204_800, 32_768, { reasoning: true }],
  ['MiniMax/MiniMax-M1-80k', 'MiniMax M1 80k', 80_000, 16_384, { reasoning: true }],
  ['stepfun-ai/Step-5-Preview', 'Step-5 Preview', 262_144, 65_536, { reasoning: true }],
  ['stepfun-ai/Step-3.7-Flash', 'Step-3.7 Flash', 262_144, 32_768, { reasoning: true }],
  ['stepfun-ai/Step-3.5-Flash', 'Step-3.5 Flash', 262_144, 32_768, { reasoning: true }],
  ['Shanghai_AI_Laboratory/Intern-S2-Preview', 'Intern-S2 Preview', 131_072, 32_768, { image: true, reasoning: true }],
  ['Shanghai_AI_Laboratory/Intern-S1', 'Intern-S1', 131_072, 32_768, { image: true, reasoning: true }],
  ['Shanghai_AI_Laboratory/Intern-S1-mini', 'Intern-S1 mini', 131_072, 32_768, { image: true, reasoning: true }],
  ['OpenGVLab/InternVL3_5-241B-A28B', 'InternVL3.5 241B A28B', 131_072, 16_384, { image: true }],
  ['PaddlePaddle/ERNIE-4.5-VL-28B-A3B-PT', 'ERNIE 4.5 VL 28B A3B', 131_072, 16_384, { image: true }],
  ['PaddlePaddle/ERNIE-4.5-300B-A47B-PT', 'ERNIE 4.5 300B A47B', 131_072, 16_384, { reasoning: true }],
  ['PaddlePaddle/ERNIE-4.5-21B-A3B-PT', 'ERNIE 4.5 21B A3B', 131_072, 16_384, { reasoning: true }],
  ['PaddlePaddle/ERNIE-4.5-0.3B-PT', 'ERNIE 4.5 0.3B', 32_768, 8_192, {}],
  ['mistralai/Mistral-Large-Instruct-2407', 'Mistral Large 2407', 131_072, 16_384, {}],
  ['meituan-longcat/LongCat-Flash-Lite', 'LongCat Flash Lite', 131_072, 16_384, {}],
  ['nex-agi/Nex-N2.5-Pro', 'Nex-N2.5 Pro', 131_072, 32_768, { reasoning: true }],
  ['nex-agi/Nex-N2.5-mini', 'Nex-N2.5 mini', 131_072, 16_384, { reasoning: true }],
  ['early-access/EA-29B-A4B', 'EA 29B A4B', 131_072, 16_384, {}],
  ['MedAIBase/AntAngelMed', 'AntAngelMed', 131_072, 16_384, {}],
  ['opencompass/CompassJudger-1-32B-Instruct', 'CompassJudger 1 32B', 32_768, 8_192, {}],
  ['XGenerationLab/XiYanSQL-QwenCoder-32B-2412', 'XiYanSQL QwenCoder 2412', 32_768, 8_192, {}],
  ['XGenerationLab/XiYanSQL-QwenCoder-32B-2504', 'XiYanSQL QwenCoder 2504', 32_768, 8_192, {}],
]

/** 内置模型目录（带 `efforts`，形状与 `catalog()` 的返回值一致）。 */
export const CURATED_MODELS = MODEL_TABLE.map(([id, name, contextWindow, maxTokens, flags]) => ({
  id,
  name,
  contextWindow,
  maxTokens,
  multimodal: flags?.image === true,
  reasoning: flags?.reasoning === true,
  efforts: flags?.reasoning === true ? [...REASONING_EFFORTS] : [],
}))

/** 内置目录里排第一的模型，作为「测试连接」的默认目标。 */
export const PREFERRED_MODEL_ID = CURATED_MODELS[0].id

/**
 * 把模型 id 变成界面上的短名字。
 * @param {string} id 上游模型 id。
 * @returns {string} 短名字。
 */
export function shortModelName(id) {
  const tail = String(id).split('/').pop() ?? String(id)
  return tail === '' ? String(id) : tail
}

/**
 * 判断一个上游 id 是否是聊天模型。
 *
 * 图像生成和向量/语音端点也会出现在同一个 `/v1/models` 列表里，放进选择器只
 * 会让用户选中之后报错。
 * @param {string} id 上游模型 id。
 * @returns {boolean} 是否保留。
 */
export function isChatModel(id) {
  if (typeof id !== 'string' || id.trim() === '') return false
  const value = id.trim()
  if (IMAGE_ONLY.test(value)) return false
  if (NON_CHAT.test(value)) return false
  return true
}

/**
 * 给一个没见过的模型一组保守元数据。
 * @param {string} id 上游模型 id。
 * @returns {object} 模型目录条目。
 */
export function describeUnknown(id) {
  return {
    id,
    name: shortModelName(id),
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    multimodal: /vl|vision|multimodal|omni/i.test(id),
    reasoning: false,
    efforts: [],
  }
}

/**
 * 合并线上目录与内置元数据。
 *
 * 线上目录是权威的模型集合（账号能访问哪些就是哪些）；内置表只负责补元数据。
 * 线上目录为空（拉取失败或没有模型）时才回落到内置精选。
 * @param {Array<string>|undefined} ids 上游返回的模型 id。
 * @returns {Array<object>} 模型目录条目。
 */
export function mergeCatalog(ids) {
  const list = Array.isArray(ids) ? ids : []
  const known = new Map(CURATED_MODELS.map((model) => [model.id, model]))
  const seen = new Set()
  /** @type {Array<object>} */
  const merged = []
  for (const raw of list) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!isChatModel(id) || seen.has(id)) continue
    seen.add(id)
    merged.push(known.get(id) ?? describeUnknown(id))
  }
  if (merged.length === 0) return CURATED_MODELS.map((model) => ({ ...model }))
  return merged
}

/**
 * 生成 pi-ai 的模型描述符。
 *
 * `compat` 这几项是 ModelScope 实测过的：它是 DeepSeek 风格的 OpenAI 兼容层，
 * 接受 `thinking: {type: "disabled"}`、忽略 `store`、不接受 `developer` 角色。
 * @param {object} info 模型目录条目。
 * @param {string} baseUrl OpenAI 兼容端点（不带结尾 `/`）。
 * @param {string} providerId provider 路由 id。
 * @returns {object} pi-ai 模型描述符。
 */
export function toPiModel(info, baseUrl, providerId) {
  const thinkingLevelMap = info.reasoning
    ? Object.fromEntries([['minimal', null], ...info.efforts.map((effort) => [effort, effort])])
    : undefined
  return {
    id: info.id,
    name: info.name,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    input: info.multimodal ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
    reasoning: thinkingLevelMap !== undefined,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    compat: {
      supportsReasoningEffort: thinkingLevelMap !== undefined,
      supportsUsageInStreaming: true,
      supportsStore: true,
      supportsDeveloperRole: false,
      supportsStrictMode: false,
      requiresReasoningContentOnAssistantMessages: false,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'deepseek',
    },
  }
}