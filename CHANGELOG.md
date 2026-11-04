# Changelog

## 1.0.0

首个版本。

- 自注册 `modelscope` provider（OpenAI 兼容层 + `thinkingFormat: deepseek`），不需要手写 `llm-pi-ai` 配置。
- API Key 存进 DSH 凭据服务（`MODELSCOPE_API_KEY`），卡片保存后下一次请求生效，不用重启。
- 挂载时拉取 `GET /v1/models`，过滤图像 / 向量 / 语音端点；拉取失败回落到内置 35 个聊天模型。
- 插件页卡片：保存并验证、刷新模型、测试连接、清除密钥；所有路由仅限回环来源。
- 离线自检覆盖目录过滤、元数据合并、密钥优先级和路由校验。