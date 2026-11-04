/**
 * dsh-connect-modelscope — 离线自检。
 *
 * 覆盖三块不需要宿主的东西：
 * 1. `lib/models.js`：目录过滤、内置元数据合并、pi-ai 描述符；
 * 2. `lib/key-store.js`：凭据 → 内存 → 环境变量的优先级；
 * 3. `lib/routes.js`：回环校验、方法校验、body 校验、状态码映射。
 *
 * Host 半部分（`lib/index.js`）会 import pi-ai / dsh-llm 这些 peer，只有装进
 * DSH 之后才能解析，所以这里不做 `import`，只用 `node --check` 保证语法。
 *
 * 用法：`node scripts/selftest.mjs`
 */

import {
  CURATED_MODELS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  describeUnknown,
  isChatModel,
  mergeCatalog,
  shortModelName,
  toPiModel,
} from '../lib/models.js'
import { createKeyStore, maskKey } from '../lib/key-store.js'
import { registerRoutes } from '../lib/routes.js'

let passed = 0
const failures = []

/**
 * 断言。
 * @param {string} label 用例名。
 * @param {boolean} condition 条件。
 * @param {string} [detail] 失败时补充信息。
 * @returns {void}
 */
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(detail === undefined ? label : `${label} — ${detail}`)
}

/**
 * 断言两个值相等。
 * @param {string} label 用例名。
 * @param {unknown} actual 实际值。
 * @param {unknown} expected 期望值。
 * @returns {void}
 */
function equal(label, actual, expected) {
  check(label, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，得到 ${JSON.stringify(actual)}`)
}

/** 假的响应对象。 */
function fakeRes() {
  return {
    statusCode: 0,
    headers: undefined,
    payload: '',
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(payload) {
      this.payload = payload ?? ''
      this.writableEnded = true
    },
    body() {
      return this.payload === '' ? undefined : JSON.parse(this.payload)
    },
  }
}

/**
 * 假的请求对象：监听器先登记，body 在下一个 tick 送出。
 * @param {object} [options] 选项。
 * @returns {object} 请求对象。
 */
function fakeReq(options = {}) {
  const { method = 'GET', headers = {}, body, remoteAddress = '::ffff:127.0.0.1' } = options
  const listeners = new Map()
  const req = {
    method,
    headers: { host: '127.0.0.1:2144', ...headers },
    socket: { remoteAddress },
    destroyed: false,
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(callback)
      return req
    },
    destroy() {
      req.destroyed = true
    },
  }
  setImmediate(() => {
    if (req.destroyed) return
    if (body !== undefined) for (const callback of listeners.get('data') ?? []) callback(Buffer.from(body))
    for (const callback of listeners.get('end') ?? []) callback()
  })
  return req
}

/**
 * 造一个只记录路由的假 ctx。
 * @returns {{ctx: object, routes: Array<object>, dispose: () => void}} 测试用上下文。
 */
function fakeWebCtx() {
  const routes = []
  const disposers = []
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
  }
  return {
    ctx,
    routes,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

/**
 * 跑一个路由。
 * @param {object} route 路由对象。
 * @param {object} req 请求。
 * @returns {Promise<object>} 响应。
 */
async function call(route, req) {
  const res = fakeRes()
  await route.handler(req, res)
  return res
}

/** 测试模型目录。 */
function testModels() {
  equal('内置目录条数', CURATED_MODELS.length, 35)
  check('每个内置模型都有 reasoning 标记', CURATED_MODELS.every((model) => typeof model.reasoning === 'boolean'))

  check('图像模型被过滤', isChatModel('Qwen/Qwen-Image-Edit') === false)
  check('向量模型被过滤', isChatModel('BAAI/bge-m3-embed') === false)
  check('语音模型被过滤', isChatModel('iic/CosyVoice-300M') === false)
  check('正常聊天模型保留', isChatModel('Qwen/Qwen3.5-27B') === true)
  check('空 id 被过滤', isChatModel('   ') === false)

  const fallback = mergeCatalog([])
  equal('空目录回落内置', fallback.length, CURATED_MODELS.length)

  const merged = mergeCatalog(['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'Qwen/Qwen-Image-Edit', 'someone/unknown-9b'])
  equal('线上目录去掉了图像模型', merged.length, 2)
  equal('未知模型用保守上下文', merged[1].contextWindow, DEFAULT_CONTEXT_WINDOW)
  equal('未知模型用保守输出上限', merged[1].maxTokens, DEFAULT_MAX_TOKENS)
  equal('未知模型名字取短名', merged[1].name, 'unknown-9b')
  equal('短名函数', shortModelName('a/b/c'), 'c')
  equal('未知模型带默认标记', describeUnknown('x/y').reasoning, false)

  const reasoning = toPiModel(CURATED_MODELS[0], 'https://example.test/v1', 'modelscope')
  equal('描述符 api', reasoning.api, 'openai-completions')
  equal('描述符 provider', reasoning.provider, 'modelscope')
  equal('描述符 baseUrl', reasoning.baseUrl, 'https://example.test/v1')
  check('多模态模型带图片输入', Array.isArray(reasoning.input) && reasoning.input.includes('image'))
  check('推理模型有 thinkingLevelMap', reasoning.thinkingLevelMap !== undefined)
  equal('thinkingLevelMap.minimal', reasoning.thinkingLevelMap.minimal, null)
  equal('thinkingLevelMap.high', reasoning.thinkingLevelMap.high, 'high')
  equal('compat.maxTokensField', reasoning.compat.maxTokensField, 'max_tokens')
  equal('compat.thinkingFormat', reasoning.compat.thinkingFormat, 'deepseek')
  equal('cost 全零', reasoning.cost.input, 0)

  const textOnly = toPiModel(CURATED_MODELS.find((model) => model.id === 'PaddlePaddle/ERNIE-4.5-0.3B-PT'), 'https://example.test/v1', 'modelscope')
  equal('非推理模型 reasoning=false', textOnly.reasoning, false)
  check('非推理模型没有 thinkingLevelMap', textOnly.thinkingLevelMap === undefined)
  equal('文字模型输入只有 text', JSON.stringify(textOnly.input), JSON.stringify(['text']))
  equal('非推理模型不发 reasoning effort', textOnly.compat.supportsReasoningEffort, false)
}

/** 测试密钥存取。 */
async function testKeyStore() {
  equal('遮罩长密钥', maskKey('ms-0123456789abcdef-0123456789abcdef'), 'ms-012…cdef')
  equal('遮罩空串', maskKey(''), '')
  check('遮罩短密钥不泄露尾部', !maskKey('abcdefghij').includes('cdefgh'))

  const vault = new Map()
  const credentials = {
    async resolve(ref) {
      const value = vault.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async set(ref, value) {
      vault.set(ref, value)
    },
    async unset(ref) {
      vault.delete(ref)
    },
  }

  const env = { MODELSCOPE_API_KEY: 'ms-from-env' }
  const store = createKeyStore({ credentials, env })
  equal('引用名', store.ref, 'MODELSCOPE_API_KEY')

  const fromEnv = await store.resolve()
  equal('没配凭据时用环境变量', fromEnv?.source, 'env')
  equal('环境变量值', fromEnv?.value, 'ms-from-env')

  await store.save('  ms-typed  ')
  const saved = await store.resolve()
  equal('保存后来源是凭据服务', saved?.source, 'file')
  equal('保存时去空白', saved?.value, 'ms-typed')

  let rejected = false
  try {
    await store.save('   ')
  } catch {
    rejected = true
  }
  check('拒绝空密钥', rejected)

  await store.forget()
  const afterForget = await store.resolve()
  equal('清除后回落到环境变量', afterForget?.source, 'env')

  const memoryOnly = createKeyStore({ credentials: undefined, env: {} })
  equal('没有凭据也没有环境变量时无值', await memoryOnly.resolve(), undefined)
  const memorySaved = await memoryOnly.save('ms-memory')
  equal('无凭据服务时落到内存', memorySaved.source, 'memory')
  equal('内存兜底可读回', (await memoryOnly.resolve())?.value, 'ms-memory')
}

/** 测试 HTTP 路由。 */
async function testRoutes() {
  const calls = { status: 0, save: [], forget: 0, refresh: 0, test: [] }
  const deps = {
    prefix: '/plugins/dsh-connect-modelscope',
    status: async () => {
      calls.status += 1
      return { ok: true }
    },
    saveKey: async (apiKey) => {
      calls.save.push(apiKey)
      return { ok: true, validation: { ok: true } }
    },
    forgetKey: async () => {
      calls.forget += 1
      return { ok: true }
    },
    refresh: async () => {
      calls.refresh += 1
      return { ok: true, refresh: { ok: true } }
    },
    test: async (body) => {
      calls.test.push(body)
      return { ok: true, model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017' }
    },
  }

  const { ctx, routes, dispose } = fakeWebCtx()
  registerRoutes(ctx, deps)
  equal('注册四条路由', routes.length, 4)
  const routeAt = (suffix) => routes.find((route) => route.path === `/plugins/dsh-connect-modelscope/${suffix}`)
  check('status 路由存在', routeAt('status') !== undefined)
  check('key 路由存在', routeAt('key') !== undefined)
  check('refresh 路由存在', routeAt('refresh') !== undefined)
  check('test 路由存在', routeAt('test') !== undefined)
  check('路由 kind 是 exact', routes.every((route) => route.kind === 'exact'))

  const statusRoute = routeAt('status')
  const ok = await call(statusRoute, fakeReq())
  equal('status 200', ok.statusCode, 200)
  equal('status body', JSON.stringify(ok.body()), JSON.stringify({ ok: true }))
  equal('status 不缓存', ok.headers['Cache-Control'], 'no-store')

  const wrongMethod = await call(statusRoute, fakeReq({ method: 'POST' }))
  equal('status 拒绝 POST', wrongMethod.statusCode, 405)

  const lan = await call(statusRoute, fakeReq({ remoteAddress: '192.168.1.9' }))
  equal('非回环来源被拒', lan.statusCode, 403)
  equal('非回环来源错误码', lan.body().error, 'loopback-only')

  const lanHost = await call(statusRoute, fakeReq({ headers: { host: '192.168.1.9:2144' } }))
  equal('非回环 Host 被拒', lanHost.statusCode, 403)

  const evilOrigin = await call(statusRoute, fakeReq({ headers: { origin: 'https://evil.example' } }))
  equal('外站 Origin 被拒', evilOrigin.statusCode, 403)
  equal('外站 Origin 错误码', evilOrigin.body().error, 'origin-not-trusted')

  const goodOrigin = await call(statusRoute, fakeReq({ headers: { origin: 'http://127.0.0.1:2144' } }))
  equal('本机 Origin 放行', goodOrigin.statusCode, 200)

  const keyRoute = routeAt('key')
  const saved = await call(keyRoute, fakeReq({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'ms-typed' }) }))
  equal('保存密钥 200', saved.statusCode, 200)
  equal('保存密钥把值传给 deps', calls.save[0], 'ms-typed')

  const badJson = await call(keyRoute, fakeReq({ method: 'POST', body: '{not json' }))
  equal('坏 JSON 返回 400', badJson.statusCode, 400)

  const arrayJson = await call(keyRoute, fakeReq({ method: 'POST', body: '[]' }))
  equal('非对象 JSON 返回 400', arrayJson.statusCode, 400)

  const getKey = await call(keyRoute, fakeReq({ method: 'GET' }))
  equal('GET key 返回 405', getKey.statusCode, 405)

  const removed = await call(keyRoute, fakeReq({ method: 'DELETE' }))
  equal('DELETE key 200', removed.statusCode, 200)
  equal('DELETE 调到 forget', calls.forget, 1)

  const refreshed = await call(routeAt('refresh'), fakeReq({ method: 'POST' }))
  equal('refresh 200', refreshed.statusCode, 200)
  equal('refresh 调了一次', calls.refresh, 1)

  const tested = await call(routeAt('test'), fakeReq({ method: 'POST' }))
  equal('test 200', tested.statusCode, 200)
  equal('test 拿到空 body 对象', JSON.stringify(calls.test[0]), '{}')

  // 依赖抛错时的状态码映射。
  const failing = fakeWebCtx()
  registerRoutes(failing.ctx, {
    ...deps,
    test: async () => {
      throw Object.assign(new Error('没有密钥'), { status: 400 })
    },
    status: async () => {
      throw new Error('boom')
    },
  })
  const testRoute = failing.routes.find((route) => route.path.endsWith('/test'))
  const badTest = await call(testRoute, fakeReq({ method: 'POST' }))
  equal('deps 自定义状态码生效', badTest.statusCode, 400)
  equal('deps 错误消息透出', badTest.body().error, '没有密钥')

  const statusRoute2 = failing.routes.find((route) => route.path.endsWith('/status'))
  const badStatus = await call(statusRoute2, fakeReq())
  equal('未标注错误码时用 500', badStatus.statusCode, 500)

  const noStatus = fakeWebCtx()
  registerRoutes(noStatus.ctx, {
    ...deps,
    test: async () => {
      throw new Error('upstream 500')
    },
  })
  const upstreamTest = noStatus.routes.find((route) => route.path.endsWith('/test'))
  const upstreamFail = await call(upstreamTest, fakeReq({ method: 'POST' }))
  equal('上游错误默认 502', upstreamFail.statusCode, 502)

  dispose()
  equal('卸载时摘掉路由', routes.length, 0)
}

/** 主流程。 */
async function main() {
  testModels()
  await testKeyStore()
  await testRoutes()

  if (failures.length === 0) {
    console.log(`selftest: ${passed} passed`)
    return
  }
  console.error(`selftest: ${passed} passed, ${failures.length} failed`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exitCode = 1
}

await main()