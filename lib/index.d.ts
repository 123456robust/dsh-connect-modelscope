/**
 * dsh-connect-modelscope 的类型声明。
 *
 * 只声明 Host 半部分；`client.js` 走浏览器的模块表，不在类型层面暴露。
 */

import type { Context } from '@deepseek-ai/cordis'

/** 一个模型目录条目。 */
export interface ModelScopeModelInfo {
  /** 上游模型 id，同时也是 pi-ai 的 model id。 */
  id: string
  /** 界面显示名。 */
  name: string
  /** 上下文窗口（估值）。 */
  contextWindow: number
  /** 单次最大输出（估值）。 */
  maxTokens: number
  /** 是否接受图片输入。 */
  multimodal: boolean
  /** 是否支持推理档位。 */
  reasoning: boolean
  /** 该模型接受的推理档位。 */
  efforts: string[]
}

/** 插件设置。 */
export interface ModelScopeConfig {
  /** OpenAI 兼容端点，默认 `https://api-inference.modelscope.cn/v1`。 */
  baseURL: string
  /** 启动时是否拉一次模型目录。 */
  refreshOnStart: boolean
  /** 额外显示的模型 id（默认过滤器会挡掉的那些）。 */
  extraModels: string[]
}

/** provider 路由 id。 */
export declare const MODELSCOPE_PROVIDER: 'modelscope'

/** provider 显示名。 */
export declare const MODELSCOPE_PROVIDER_DISPLAY_NAME: 'ModelScope'

/** 默认设置命名空间。 */
export declare const MODELSCOPE_SETTINGS_NS: 'dsh-connect-modelscope'

/** 插件设置校验。 */
export declare const Config: unknown

/** 插件名（Loader 条目 id）。 */
export declare const name: 'dsh-connect-modelscope'

/** 依赖的宿主服务。 */
export declare const inject: ['llm', 'settings']

/**
 * 规整端点：补协议、去结尾斜杠。
 * @param value 配置值。
 * @returns 端点。
 */
export declare function normalizeBaseUrl(value: unknown): string

/**
 * 从上下推导设置命名空间。
 * @param ctx Cordis 上下文。
 * @returns 命名空间。
 */
export declare function settingsNamespaceOf(ctx: Context): string

/**
 * 注册 provider、拉目录、挂卡片路由。
 * @param ctx Cordis 上下文。
 * @param config 设置。
 */
export declare function apply(ctx: Context, config?: Partial<ModelScopeConfig>): void

declare const plugin: {
  name: typeof name
  inject: typeof inject
  Config: typeof Config
  apply: typeof apply
  settingsNamespaceOf: typeof settingsNamespaceOf
}

export default plugin