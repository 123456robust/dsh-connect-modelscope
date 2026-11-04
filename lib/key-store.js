/**
 * dsh-connect-modelscope — API Key 存取。
 *
 * 密钥存进 DSH 的凭据服务（`ctx.credentials`），引用名固定为
 * `MODELSCOPE_API_KEY`，和手写 `apiKeyEnv` 时的环境变量名一致。所以：
 *
 * - 卡片里保存的密钥和用户之前写在 `~/.dsh/.credentials.yaml` 里的是同一个
 *   引用，不会互相覆盖出两个身份；
 * - 凭据服务不可用时退到进程内存（重启即失效），再退到环境变量；
 * - `resolve()` 每次调用都重新解析，所以卡片保存后下一次请求立刻生效，
 *   不需要重启 DSH。
 *
 * 这个文件不 import 宿主包：凭据服务以参数传入，`scripts/selftest.mjs` 用假
 * 服务直接测。
 *
 * @module dsh-connect-modelscope/key-store
 */

/** 密钥在凭据服务里的引用名。 */
export const API_KEY_REF = 'MODELSCOPE_API_KEY'

/**
 * 凭据引用。宿主把引用当 branded string，运行时就是名字本身。
 * @param {string} name 引用名。
 * @returns {string} 引用。
 */
function credentialRef(name) {
  return name
}

/**
 * 把密钥遮成可展示的样子。
 * @param {string} value 原始密钥。
 * @returns {string} 形如 `ms-abcd…wxyz` 的遮罩值。
 */
export function maskKey(value) {
  const key = String(value ?? '').trim()
  if (key === '') return ''
  if (key.length <= 10) return `${key.slice(0, 2)}…${key.slice(-2)}`
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/**
 * 造一个密钥存取器。
 * @param {object} options 选项。
 * @param {object|(() => object|undefined)|undefined} [options.credentials] 凭据服务，或返回它的函数（服务可能后注册）。
 * @param {Record<string, string|undefined>} [options.env] 环境变量来源。
 * @param {string} [options.ref] 凭据引用名。
 * @returns {{ref: string, resolve: () => Promise<{value: string, source: string}|undefined>, save: (key: string) => Promise<{value: string, source: string}>, forget: () => Promise<void>}} 存取器。
 */
export function createKeyStore(options = {}) {
  const { credentials, env = process.env, ref = API_KEY_REF } = options

  /** 凭据服务缺席时的兜底：只在本次进程里有效。 */
  let memory

  /**
   * 取当前凭据服务实例。
   * @returns {object|undefined} 服务实例。
   */
  const service = () => {
    try {
      return (typeof credentials === 'function' ? credentials() : credentials) ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * 按 credentials → memory → env 的顺序解析密钥。
   * @returns {Promise<{value: string, source: string}|undefined>} 命中的密钥与来源。
   */
  async function resolve() {
    const store = service()
    if (store !== undefined && typeof store.resolve === 'function') {
      try {
        const hit = await store.resolve(credentialRef(ref))
        const value = typeof hit?.value === 'string' ? hit.value.trim() : ''
        if (value !== '') return { value, source: typeof hit?.source === 'string' && hit.source !== '' ? hit.source : 'credentials' }
      } catch {
        /* 凭据库暂时不可用：继续往下找 */
      }
    }
    if (typeof memory === 'string' && memory !== '') return { value: memory, source: 'memory' }
    const fromEnv = typeof env?.[ref] === 'string' ? env[ref].trim() : ''
    if (fromEnv !== '') return { value: fromEnv, source: 'env' }
    return undefined
  }

  /**
   * 保存密钥。
   * @param {string} raw 用户输入的密钥。
   * @returns {Promise<{value: string, source: string}>} 保存结果。
   */
  async function save(raw) {
    const value = String(raw ?? '').trim()
    if (value === '') throw new Error('API Key 不能为空')
    const store = service()
    if (store !== undefined && typeof store.set === 'function') {
      await store.set(credentialRef(ref), value)
      memory = value
      return { value, source: 'credentials' }
    }
    memory = value
    return { value, source: 'memory' }
  }

  /**
   * 忘掉已保存的密钥（环境变量不归插件管）。
   * @returns {Promise<void>} 无返回值。
   */
  async function forget() {
    memory = undefined
    const store = service()
    if (store !== undefined && typeof store.unset === 'function') {
      try {
        await store.unset(credentialRef(ref))
      } catch {
        /* 没配过就没什么可删的 */
      }
    }
  }

  return { ref, resolve, save, forget }
}