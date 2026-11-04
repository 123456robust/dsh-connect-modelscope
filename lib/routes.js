/**
 * dsh-connect-modelscope — 卡片用到的 HTTP 路由。
 *
 * 这几个路由能改密钥，所以全部限定回环来源（`requireLoopback`）。路由只做
 * HTTP 层面的活：验方法、验来源、读 body、把依赖抛出的错误翻成状态码。真正的
 * 状态/保存/刷新/测试逻辑由 Host 半部分传进来，因此这个文件不 import 宿主包，
 * `scripts/selftest.mjs` 可以用假 req/res 直接测。
 *
 * @module dsh-connect-modelscope/routes
 */

/** 请求体上限：只有一个小 JSON，64KB 足够。 */
const BODY_LIMIT = 65_536

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {object} body 响应体。
 * @returns {void}
 */
export function json(res, status, body) {
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

/**
 * 读一个 JSON 对象请求体。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @returns {Promise<Record<string, unknown>>} 解析后的对象。
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        // 空 body 当成 `{}`：卡片上的「测试连接」不需要带参数。
        if (text === '') {
          resolve({})
          return
        }
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('请求体必须是 JSON 对象'))
          return
        }
        resolve(parsed)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 判断主机名/IP 是否是回环。
 * @param {string|undefined} value 主机名或地址。
 * @returns {boolean} 是否回环。
 */
export function isLoopback(value) {
  if (typeof value !== 'string' || value === '') return false
  const host = value.replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || host === '::ffff:127.0.0.1' || /^127\./.test(host)
}

/**
 * 只允许本机页面调用这些路由：路由能改密钥，不能被局域网里的页面碰到。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @returns {boolean} 是否放行。
 */
export function requireLoopback(req, res) {
  const remote = req.socket?.remoteAddress
  if (!isLoopback(remote)) {
    json(res, 403, { error: 'loopback-only' })
    return false
  }
  const host = String(req.headers?.host ?? '')
  if (host !== '' && !isLoopback(host.replace(/:\d+$/, ''))) {
    json(res, 403, { error: 'host-not-trusted' })
    return false
  }
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (!isLoopback(new URL(origin).hostname)) {
        json(res, 403, { error: 'origin-not-trusted' })
        return false
      }
    } catch {
      json(res, 403, { error: 'origin-not-trusted' })
      return false
    }
  }
  return true
}

/**
 * 把错误变成一句人话。
 * @param {unknown} error 错误。
 * @returns {string} 消息。
 */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}

/**
 * 依赖抛出的错误可以带 `status`，这里读出来。
 * @param {unknown} error 错误。
 * @param {number} fallback 兜底状态码。
 * @returns {number} HTTP 状态码。
 */
function statusOf(error, fallback) {
  const value = error !== null && typeof error === 'object' ? error.status : undefined
  return typeof value === 'number' && value >= 400 && value <= 599 ? value : fallback
}

/**
 * 挂上卡片要用的四条路由。
 *
 * `ctx.effect` 收集 dispose，插件卸载时路由一起摘掉。
 * @param {object} ctx 带 `webServer` 的 Cordis 上下文。
 * @param {object} deps 依赖。
 * @param {string} deps.prefix 路由前缀，形如 `/plugins/<id>`。
 * @param {() => Promise<object>} deps.status 读状态。
 * @param {(apiKey: unknown) => Promise<object>} deps.saveKey 保存并验证密钥。
 * @param {() => Promise<object>} deps.forgetKey 清除密钥。
 * @param {() => Promise<object>} deps.refresh 重拉模型目录。
 * @param {(body: Record<string, unknown>) => Promise<object>} deps.test 打一发测试请求。
 * @returns {void}
 */
export function registerRoutes(ctx, deps) {
  const { prefix } = deps
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: `${prefix}/status`,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method-not-allowed' })
          if (!requireLoopback(req, res)) return
          try {
            json(res, 200, await deps.status())
          } catch (error) {
            json(res, statusOf(error, 500), { error: errorMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${prefix}/key`,
        handler: async (req, res) => {
          if (!requireLoopback(req, res)) return
          try {
            if (req.method === 'DELETE') {
              json(res, 200, await deps.forgetKey())
              return
            }
            if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
            const body = await readJsonBody(req)
            json(res, 200, await deps.saveKey(body.apiKey))
          } catch (error) {
            json(res, statusOf(error, 400), { error: errorMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${prefix}/refresh`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
          if (!requireLoopback(req, res)) return
          try {
            json(res, 200, await deps.refresh())
          } catch (error) {
            json(res, statusOf(error, 500), { error: errorMessage(error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${prefix}/test`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method-not-allowed' })
          if (!requireLoopback(req, res)) return
          try {
            json(res, 200, await deps.test(await readJsonBody(req)))
          } catch (error) {
            json(res, statusOf(error, 502), { error: errorMessage(error) })
          }
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* 已经释放过就算了 */
        }
      }
    }
  })
}