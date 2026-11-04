window.__ModuleLoader__.load({
  id: 'dsh-connect-modelscope',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** 浏览器插件名。 */
    const name = 'dsh-connect-modelscope-client'
    /** 需要的客户端服务。 */
    const inject = ['slots', 'locale']

    /** 卡片文案的本地化命名空间。 */
    const COPY_NS = 'settings.modelscope'
    /** 状态接口路径，与 Host 半部分一致。 */
    const PLUGIN_PATH = '/plugins/dsh-connect-modelscope'

    /** 中英文案。 */
    const COPY = {
      zh: {
        'card.title': 'ModelScope（魔搭）',
        'card.description':
          '把 ModelScope 上的模型接入 DSH。粘贴一次 API Key，插件自己注册模型目录；保存后下一次请求就生效，不用重启，也不用改配置文件。',
        'card.keyLabel': 'API Key',
        'card.keyPlaceholder': 'ms-...',
        'card.save': '保存并验证',
        'card.saving': '正在验证…',
        'card.refresh': '刷新模型',
        'card.test': '测试连接',
        'card.clear': '清除密钥',
        'card.ready': '已配置',
        'card.missing': '未配置',
        'card.source.credentials': '凭据库',
        'card.source.env': '环境变量',
        'card.source.memory': '本进程内存',
        'card.source.none': '无',
        'card.endpoint': '端点',
        'card.catalog': '模型目录',
        'card.catalogLive': '线上 · {count} 个',
        'card.catalogFallback': '内置精选 · {count} 个',
        'card.models': '可用模型',
        'card.registered': 'provider',
        'card.registeredOk': '已注册',
        'card.registeredFail': '未注册',
        'card.hint':
          'API Key 在 ModelScope「个人中心 → 访问令牌」创建：https://modelscope.cn/my/myaccesstoken 。密钥存进 DSH 的凭据服务（引用名 MODELSCOPE_API_KEY），不会写进任何配置文件。',
        'card.saved': '已保存，模型目录已更新。',
        'card.savedNoCatalog': '密钥已保存，但拉模型目录失败：{reason}',
        'card.tested': '{model} 回复正常 · {ms} ms',
        'card.failed': '操作失败：{error}',
        'card.cleared': '已清除保存的密钥。',
        'card.loading': '正在读取状态…',
        'card.unavailable': '读不到插件状态，Host 半部分可能还没就绪。',
        'card.noKey': '还没有配置密钥。填好上面的输入框，点「保存并验证」即可。',
        'card.image': '图片',
        'card.reasoning': '推理',
        'card.errorTitle': '注册失败',
      },
      en: {
        'card.title': 'ModelScope',
        'card.description':
          'Connect ModelScope models to DSH. Paste an API key once — the plugin registers the model catalog itself, and the key takes effect on the next request. No restart, no config file editing.',
        'card.keyLabel': 'API Key',
        'card.keyPlaceholder': 'ms-...',
        'card.save': 'Save & verify',
        'card.saving': 'Verifying…',
        'card.refresh': 'Refresh models',
        'card.test': 'Test connection',
        'card.clear': 'Forget key',
        'card.ready': 'Configured',
        'card.missing': 'Not configured',
        'card.source.credentials': 'credential store',
        'card.source.env': 'environment',
        'card.source.memory': 'this process',
        'card.source.none': 'none',
        'card.endpoint': 'Endpoint',
        'card.catalog': 'Catalog',
        'card.catalogLive': 'live · {count}',
        'card.catalogFallback': 'built-in · {count}',
        'card.models': 'Models',
        'card.registered': 'provider',
        'card.registeredOk': 'registered',
        'card.registeredFail': 'not registered',
        'card.hint':
          'Create an API key at ModelScope → Profile → Access tokens: https://modelscope.cn/my/myaccesstoken . The key is stored in the DSH credential store as MODELSCOPE_API_KEY; it never touches a config file.',
        'card.saved': 'Saved. The catalog has been updated.',
        'card.savedNoCatalog': 'Key saved, but the catalog fetch failed: {reason}',
        'card.tested': '{model} answered in {ms} ms',
        'card.failed': 'Failed: {error}',
        'card.cleared': 'Saved key removed.',
        'card.loading': 'Reading status…',
        'card.unavailable': 'Cannot read plugin status; the Host half may not be ready yet.',
        'card.noKey': 'No key configured yet. Paste one above and press “Save & verify”.',
        'card.image': 'image',
        'card.reasoning': 'reasoning',
        'card.errorTitle': 'Registration failed',
      },
    }

    /**
     * 填模板变量。
     * @param {string} template 模板。
     * @param {Record<string, unknown>} [vars] 变量。
     * @returns {string} 结果。
     */
    function fill(template, vars) {
      return template.replace(/\{(\w+)\}/g, (whole, key) => (vars?.[key] === undefined ? whole : String(vars[key])))
    }

    /**
     * 拉插件状态。
     * @returns {Promise<object|undefined>} 状态对象，失败返回 undefined。
     */
    async function fetchStatus() {
      try {
        const response = await fetch(`${PLUGIN_PATH}/status`, { headers: { Accept: 'application/json' } })
        if (!response.ok) return undefined
        return await response.json()
      } catch {
        return undefined
      }
    }

    /**
     * 发一个 JSON 请求。
     * @param {string} path 路径。
     * @param {object} [options] 选项。
     * @param {string} [options.method] HTTP 方法。
     * @param {object} [options.body] 请求体。
     * @returns {Promise<object|undefined>} 响应体。
     */
    async function request(path, options = {}) {
      const response = await fetch(PLUGIN_PATH + path, {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin',
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    /**
     * 取一次状态，支持手动刷新。
     * @returns {{status: object|undefined, loading: boolean, reload: () => void}} 状态与刷新函数。
     */
    function useStatus() {
      const [status, setStatus] = React.useState(undefined)
      const [loading, setLoading] = React.useState(true)
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        setLoading(true)
        fetchStatus().then((next) => {
          if (!alive) return
          setStatus(next)
          setLoading(false)
        })
        return () => {
          alive = false
        }
      }, [revision])
      return { status, loading, reload: () => setRevision((value) => value + 1) }
    }

    /**
     * 一个按钮。
     * @param {object} props 属性。
     * @returns {object} 元素。
     */
    function Button(props) {
      const { primary, disabled, onClick, children } = props
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          style: {
            padding: '5px 12px',
            borderRadius: 6,
            fontSize: 13,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            border: primary ? '1px solid transparent' : '1px solid var(--dsw-alias-border-default)',
            background: primary ? 'var(--dsw-alias-text-primary)' : 'transparent',
            color: primary ? 'var(--dsw-alias-bg-base, #fff)' : 'var(--dsw-alias-text-primary)',
            whiteSpace: 'nowrap',
          },
        },
        children,
      )
    }

    /** 一行键值对。 */
    function Row(props) {
      return h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' } },
        h('span', { style: { color: 'var(--dsw-alias-text-secondary)', minWidth: 88 } }, props.label),
        h('span', { style: { color: 'var(--dsw-alias-text-primary)', wordBreak: 'break-all' } }, props.value),
      )
    }

    /** 设置页里的插件卡片。 */
    function ModelScopeCard(props) {
      const t = props.t ?? ((key) => key)
      const { status, loading, reload } = useStatus()
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(undefined)

      /**
       * 跑一个会写状态的动作。
       * @param {string} label 动作标识。
       * @param {() => Promise<void>} action 动作。
       * @returns {Promise<void>} 无返回值。
       */
      const run = async (label, action) => {
        setBusy(label)
        setMessage(undefined)
        try {
          await action()
        } catch (error) {
          setMessage({ tone: 'error', text: fill(t('card.failed'), { error: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setBusy('')
        }
      }

      /** 保存并验证。 */
      const onSave = () =>
        run('save', async () => {
          const result = await request('/key', { method: 'POST', body: { apiKey: draft } })
          setDraft('')
          reload()
          if (result?.validation?.ok === false) {
            setMessage({ tone: 'warn', text: fill(t('card.savedNoCatalog'), { reason: result.validation.error ?? '' }) })
            return
          }
          setMessage({ tone: 'ok', text: t('card.saved') })
        })

      /** 重拉目录。 */
      const onRefresh = () =>
        run('refresh', async () => {
          const result = await request('/refresh', { method: 'POST', body: {} })
          reload()
          if (result?.refresh?.ok === false) {
            setMessage({ tone: 'warn', text: fill(t('card.savedNoCatalog'), { reason: result.refresh.reason ?? '' }) })
            return
          }
          setMessage({ tone: 'ok', text: t('card.saved') })
        })

      /** 打一发极小请求。 */
      const onTest = () =>
        run('test', async () => {
          const result = await request('/test', { method: 'POST', body: {} })
          setMessage({ tone: 'ok', text: fill(t('card.tested'), { model: result?.model ?? '', ms: result?.latencyMs ?? 0 }) })
        })

      /** 清除已保存的密钥。 */
      const onClear = () =>
        run('clear', async () => {
          await request('/key', { method: 'DELETE' })
          reload()
          setMessage({ tone: 'warn', text: t('card.cleared') })
        })

      const children = [h('div', { key: 'title', style: { fontSize: 15, fontWeight: 600, marginBottom: 4 } }, t('card.title'))]

      children.push(
        h('div', { key: 'desc', style: { color: 'var(--dsw-alias-text-secondary)', marginBottom: 12, lineHeight: 1.5 } }, t('card.description')),
      )

      if (loading && status === undefined) {
        children.push(h('div', { key: 'loading', style: { color: 'var(--dsw-alias-text-secondary)' } }, t('card.loading')))
        return h('div', { style: { padding: '4px 0 8px' } }, children)
      }
      if (status === undefined) {
        children.push(h('div', { key: 'unavailable', style: { color: 'var(--dsw-alias-text-secondary)' } }, t('card.unavailable')))
        return h('div', { style: { padding: '4px 0 8px' } }, children)
      }

      const keyInfo = status.key ?? {}
      const sourceLabel = {
        credentials: t('card.source.credentials'),
        env: t('card.source.env'),
        memory: t('card.source.memory'),
        none: t('card.source.none'),
      }[keyInfo.source ?? 'none'] ?? (keyInfo.source ?? '')

      children.push(
        h(
          'div',
          { key: 'key', style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
          h('span', { style: { color: 'var(--dsw-alias-text-secondary)', minWidth: 88 } }, t('card.keyLabel')),
          h('input', {
            type: 'password',
            value: draft,
            placeholder: keyInfo.configured ? keyInfo.masked ?? '' : t('card.keyPlaceholder'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && draft.trim() !== '' && busy === '') onSave()
            },
            style: {
              flex: '1 1 220px',
              minWidth: 160,
              padding: '5px 8px',
              borderRadius: 6,
              fontSize: 13,
              border: '1px solid var(--dsw-alias-border-default)',
              background: 'transparent',
              color: 'var(--dsw-alias-text-primary)',
            },
          }),
          h(Button, { primary: true, disabled: busy !== '' || draft.trim() === '', onClick: onSave }, busy === 'save' ? t('card.saving') : t('card.save')),
        ),
      )

      children.push(
        h(
          'div',
          { key: 'buttons', style: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
          h(Button, { disabled: busy !== '', onClick: onRefresh }, busy === 'refresh' ? t('card.saving') : t('card.refresh')),
          h(Button, { disabled: busy !== '', onClick: onTest }, busy === 'test' ? t('card.saving') : t('card.test')),
          h(Button, { disabled: busy !== '', onClick: onClear }, t('card.clear')),
        ),
      )

      if (message !== undefined) {
        const toneColor =
          message.tone === 'ok'
            ? 'var(--dsw-alias-status-success)'
            : message.tone === 'error'
              ? 'var(--dsw-alias-status-error, #d14343)'
              : 'var(--dsw-alias-status-warning)'
        children.push(
          h('div', { key: 'message', style: { color: toneColor, marginBottom: 12, lineHeight: 1.5, fontSize: 13, wordBreak: 'break-word' } }, message.text),
        )
      }

      children.push(
        h(
          'div',
          { key: 'facts', style: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 12 } },
          h(Row, {
            label: t('card.keyLabel'),
            value: keyInfo.configured ? `${t('card.ready')} · ${sourceLabel} · ${keyInfo.masked ?? ''}` : t('card.missing'),
          }),
          h(Row, { label: t('card.endpoint'), value: status.baseURL ?? '—' }),
          h(Row, {
            label: t('card.catalog'),
            value: status.catalog?.live
              ? fill(t('card.catalogLive'), { count: status.catalog?.count ?? 0 })
              : fill(t('card.catalogFallback'), { count: status.catalog?.count ?? 0 }),
          }),
          h(Row, {
            label: t('card.registered'),
            value: status.registered ? t('card.registeredOk') : t('card.registeredFail'),
          }),
        ),
      )

      if (!status.registered && status.error) {
        children.push(
          h(
            'div',
            {
              key: 'registrationError',
              style: {
                color: 'var(--dsw-alias-status-error, #d14343)',
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 12,
                padding: '6px 8px',
                border: '1px solid var(--dsw-alias-border-default)',
                borderRadius: 6,
              },
            },
            `${t('card.errorTitle')}: ${status.error}`,
          ),
        )
      }

      if (!keyInfo.configured) {
        children.push(
          h('div', { key: 'noKey', style: { color: 'var(--dsw-alias-text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 12 } }, t('card.noKey')),
        )
      }

      const models = Array.isArray(status.models) ? status.models : []
      children.push(
        h('div', { key: 'modelsLabel', style: { fontWeight: 600, marginBottom: 4 } }, `${t('card.models')} (${models.length})`),
        h(
          'div',
          {
            key: 'models',
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              maxHeight: 220,
              overflowY: 'auto',
              marginBottom: 10,
              paddingRight: 4,
            },
          },
          models.map((model) =>
            h(
              'div',
              { key: model.id, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '1px 0' } },
              h('code', { style: { color: 'var(--dsw-alias-text-primary)', wordBreak: 'break-all' } }, model.id),
              model.multimodal ? h('span', { style: { color: 'var(--dsw-alias-text-secondary)' } }, t('card.image')) : null,
              model.reasoning ? h('span', { style: { color: 'var(--dsw-alias-text-secondary)' } }, t('card.reasoning')) : null,
            ),
          ),
        ),
        h('div', { key: 'hint', style: { color: 'var(--dsw-alias-text-secondary)', fontSize: 12, lineHeight: 1.6 } }, t('card.hint')),
      )

      return h('div', { style: { padding: '4px 0 8px' } }, children)
    }

    /**
     * 注册入口。
     * @param {object} ctx 客户端上下文。
     */
    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(COPY_NS, COPY), 'dsh-connect-modelscope: settings copy')
        const t = ctx.locale.bind(COPY_NS)

        const registerCard = (slotName, key) => {
          try {
            return ctx.slots.inject(slotName, () =>
              ctx.slots.register(
                {
                  name: slotName,
                  key,
                  priority: 30,
                  inject: () => ({ t }),
                },
                ModelScopeCard,
              ),
            )
          } catch (error) {
            console.error(`[dsh-connect-modelscope] card slot "${slotName}" failed to register (host provider unaffected):`, error)
            return undefined
          }
        }

        const disposers = [
          registerCard('plugins.bundle.config', 'dsh-connect-modelscope'),
          registerCard('plugins.row.config', 'dsh-connect-modelscope#dsh-connect-modelscope'),
        ].filter((dispose) => typeof dispose === 'function')

        ctx.effect(() => () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              /* 已经释放过就算了 */
            }
          }
        }, 'dsh-connect-modelscope: slots')
      } catch (error) {
        console.error('[dsh-connect-modelscope] client apply failed:', error)
      }
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = inject
    module.exports.name = name
    return module.exports
  },
})