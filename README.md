# dsh-connect-modelscope

把 [ModelScope（魔搭）](https://modelscope.cn) 的模型接进 DeepSeek Harness。**只填一次 API Key**：插件自己注册 `modelscope` provider、自己拉模型目录、自己处理 DeepSeek 风格的 `thinking` 参数。不用手写 YAML，不用重启 DSH，体积不到 100 KB。

## 为什么用它

手写 `llm-pi-ai` 配置要填 baseURL、三十多个模型 id、每个模型的 `compat` 和推理档位，换账号还得整段重来。这个插件把这些固定下来：

- 密钥存进 DSH 的凭据服务（引用名 `MODELSCOPE_API_KEY`），不落任何配置文件；
- 保存后下一次请求立即生效，不需要重启；
- 模型目录从 `GET /v1/models` 自动拉取，过滤掉图像生成 / 向量 / 语音端点；
- 拉不到目录时退回内置精选（含 `deepseek-ai/DeepSeek-V4.1-Flash-1017`），不会让模型选择器空掉。

## 安装

在 DSH 的**设置 → 插件**里安装 bundle，填入：

```
github:123456robust/dsh-connect-modelscope
```

或者在本机克隆后，用插件页的「从本地目录安装」选中仓库根目录。安装完重启一次 DSH（第一次装 bundle 需要）。

## 使用

1. 打开 **设置 → 插件**，找到 **ModelScope（魔搭）** 卡片；
2. 在 [ModelScope 访问令牌](https://modelscope.cn/my/myaccesstoken) 页面创建一个 API Key（`ms-` 开头）；
3. 粘进输入框，点 **保存并验证**。卡片会显示密钥来源、端点、模型数量和模型列表；
4. 在模型选择器里选 `ModelScope`，挑一个模型开始用。

卡片上的其他按钮：

- **刷新模型**：重新拉一次 `/v1/models`（换了账号权限、平台上新模型时用）；
- **测试连接**：发一个 `max_tokens: 8` 的极小请求，验证密钥和模型都通；
- **清除密钥**：删掉凭据服务里的 `MODELSCOPE_API_KEY`（环境变量不归插件管）。

## 密钥存在哪

| 位置 | 说明 |
| --- | --- |
| `ctx.credentials`（引用 `MODELSCOPE_API_KEY`） | 卡片保存的密钥，DSH 自己管理，owner-only |
| 环境变量 `MODELSCOPE_API_KEY` | 没有保存过密钥时的兜底 |
| 进程内存 | 宿主没有凭据服务时的兜底，重启即失效 |

解析顺序是「凭据服务 → 内存 → 环境变量」。`MODELSCOPE_API_KEY` 这个名字和你之前手写 `apiKeyEnv` 时用的完全一样，所以已有的密钥不用重新填。

## 配置项

都在插件设置里，一般不用动：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | `https://api-inference.modelscope.cn/v1` | OpenAI 兼容端点，换私有网关时才改 |
| `refreshOnStart` | `true` | 启动时拉一次模型目录 |
| `extraModels` | `[]` | 额外显示的模型 id（默认被过滤掉的图像模型等） |

## 从手写配置迁移

如果你之前按下面这种方式手写过 `llm-pi-ai`：

```yaml
- id: llm-pi-ai
  config:
    providers:
      modelscope:
        apiKeyEnv: MODELSCOPE_API_KEY
        baseURL: https://api-inference.modelscope.cn/v1
```

**请把 `providers.modelscope` 整段删掉**，否则同一个 provider 会被注册两次，卡片里会显示「provider 注册失败」。`agent-default-model` 里 `provider: modelscope` 的配置可以保留，插件接管后仍然有效。

## 模型元数据

ModelScope 的 `/v1/models` 只返回 id，不返回上下文窗口、输出上限、是否多模态。插件内置了一张表（35 个聊天模型），表里没有的新模型用保守默认值（128K 上下文、16K 输出、纯文本）。所以：

- 上下文占用按 128K 算，可能比模型真实窗口小 —— 保守总比超限安全；
- 新上线的多模态模型如果没被识别成可读图，可以在设置页确认模型是否带「图片」标记，必要时开 issue 补表。

## 开发与测试

```bash
npm test        # 离线自检：目录过滤、元数据合并、凭据优先级、路由校验
```

离线自检不需要 DSH，也不联网。真正装进 DSH 后，卡片和聊天请求会走真实上游。

## 卸载

插件页停用或卸载 bundle，然后重启 DSH。密钥会留在凭据服务里，想一起清掉就先点卡片上的「清除密钥」。

## License

MIT