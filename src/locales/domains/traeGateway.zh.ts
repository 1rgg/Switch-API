/**
 * 文案域：**Trae 产品线 · 产品线切换与网关管理**（中文，键的权威之一）。
 *
 * 归属文件：
 * `src/components/trae-variant-bar.tsx`、`src/components/trae-variant-switch.tsx`、
 * `src/components/gateway/trae-model-list.tsx`、`src/components/gateway/trae-request-log.tsx`、
 * `src/components/gateway/trae-integration-guide.tsx`、
 * `src/components/gateway/trae-api-key-table.tsx`
 * （账号池卡已两侧共用，文案在 `shared.zh.ts`）
 *
 * ⚠️ 命名空间用 `trae`（不是 `traeGateway`）：与另两个 Trae 域共用前缀、靠二级段区分。
 *
 * 键前缀：`trae.gateway.`（产品线切换器用 `trae.variant.*`）
 */
export const zh = {
  // =====================================================================
  // trae-variant-bar.tsx —— 产品线状态条（账号页）
  // =====================================================================
  "trae.variant.bar.loggedIn": "已登录: {name}",
  "trae.variant.bar.notLoggedIn": "未登录",
  "trae.variant.bar.notDetected": "未检测到",

  // =====================================================================
  // trae-variant-switch.tsx —— 产品线切换器
  // =====================================================================
  "trae.variant.switch.aria": "选择 Trae 版本",
  "trae.variant.switch.running": "运行中",
  "trae.variant.switch.installed": "已安装",
  "trae.variant.switch.notDetected": "未检测到",
  "trae.variant.switch.tip": "{label}：{state}",
  "trae.variant.switch.tipVersion": "{label}：{state} · v{version}",

  // =====================================================================
  // gateway/trae-model-list.tsx —— 模型清单
  // =====================================================================
  "trae.gateway.models.title": "模型清单",
  "trae.gateway.models.summary": "共 {count} 个 · 默认 {model}",
  "trae.gateway.models.note": "清单读自 Trae 客户端的本地缓存（上游下发），客户端刷新后这里会跟着变；网关对外清单（/v1/models）按 API Key 的归属程序位取，两条程序位的内容不同。",
  "trae.gateway.models.empty": "暂无模型数据。",
  "trae.gateway.models.refresh": "重新读取",
  "trae.gateway.models.program": "选择目标客户端",
  "trae.gateway.models.programTip": "读取【{label}】客户端的模型清单",
  "trae.gateway.models.source": "来源",
  "trae.gateway.models.sourceCache": "客户端缓存",
  "trae.gateway.models.sourceMissing": "未读取",
  "trae.gateway.models.readAt": "读取于 {time}",
  "trae.gateway.models.readFrom": "读取自 {label} 客户端",
  "trae.gateway.models.gatewayCount": "网关对外 {count} 个",
  "trae.gateway.models.gatewayCountFor": "网关对外 {count} 个（{program}）",
  "trae.gateway.models.groupCount": "{count} 个",
  "trae.gateway.models.badgeDefault": "默认",
  "trae.gateway.models.badgeNew": "新",
  "trae.gateway.models.badgeBeta": "Beta",
  "trae.gateway.models.badgeCustom": "自定义",
  "trae.gateway.models.badgeNotServed": "网关不提供",
  // ---- 「只看网关提供的模型」开关 ----
  // 默认**关**（保底）：清单来自客户端缓存，是用户唯一一份「上游到底下发了什么」的
  // 现场证据；不可调的条目被直接抹掉后，用户会以为客户端里根本没有它。
  // 需要「一张能直接用的清单」时再打开，此时对外语义与 /v1/models 逐条一致。
  "trae.gateway.models.onlyServed": "只看网关提供的模型",
  "trae.gateway.models.onlyServedTip": "开启后隐藏「网关不提供」的行（不属于当前程序位 function、或走第三方路由的条目）。",
  "trae.gateway.models.hiddenCount": "已隐藏 {count} 个网关不提供的模型",
  // ---- 模型表格（参照 workbuddy2api-panel 的列结构，与 WorkBuddy 模型表逐列对齐）----
  "trae.gateway.models.tableHint": "表格列出当前客户端缓存里的全部模型（按 function 分组）；「网关不提供」的行不属于该程序位的 function，调用会返回 4001。",
  "trae.gateway.models.colModel": "模型",
  "trae.gateway.models.colCredits": "积分倍率",
  "trae.gateway.models.colDefaultEffort": "默认档",
  "trae.gateway.models.colEfforts": "支持的思考档位",
  "trae.gateway.models.colContext": "上下文长度",
  "trae.gateway.models.colMaxTokens": "最大输出",
  // 倍率取自模型条目的 `features.consumption_rate.data.rate`（**嵌套**字段，2026-10-07 实测定）。
  // `null`（上游没给）与 `0`（明确免费）必须分开显示。
  "trae.gateway.models.creditNone": "上游未提供该模型的积分倍率（第三方 / 自定义路由条目通常没有）。",
  "trae.gateway.models.creditTitle": "基础倍率 x{value}（不含会员折扣与限时活动）。",
  "trae.gateway.models.creditFree": "免费",
  "trae.gateway.models.creditDiscounted": "折后 x{value}",
  "trae.gateway.models.creditDiscountedTip": "会员折扣后的实际倍率 x{value}；上方的数字是基础倍率。",
  "trae.gateway.models.creditActivity": "限时活动",
  // 倍率列排序（2026-10-07 新增）——与 WorkBuddy 侧逐字同款三态：
  // 未排序 → 升序（便宜在前）→ 降序（贵在前）。
  "trae.gateway.models.creditSort": "按积分倍率排序",
  "trae.gateway.models.creditSortAsc": "倍率从低到高",
  "trae.gateway.models.creditSortDesc": "倍率从高到低",
  "trae.gateway.models.creditSortNone": "恢复原有顺序",
  "trae.gateway.models.creditSortTip": "无倍率数据的模型始终排在最后（它们不是「最便宜」，是「没这个口径」）。",
  "trae.gateway.models.effortNone": "该模型不在档位表中（上游不支持 reasoning_effort）。",
  "trae.gateway.models.effortFixed": "固定档：{effort}",
  "trae.gateway.models.effortDefaultTip": "默认档：{effort}",
  "trae.gateway.models.effortInferred": "推断",
  "trae.gateway.models.effortInferredTip": "档位表未声明默认档，这里是后端兜底值，不是上游声明。",
  "trae.gateway.models.capVision": "视觉",
  "trae.gateway.models.capNoVision": "纯文本",

  // =====================================================================
  // gateway/trae-request-log.tsx —— 请求日志
  // =====================================================================
  "trae.gateway.log.title": "请求日志（最近 {count} 条）",
  "trae.gateway.log.clear": "清空",
  "trae.gateway.log.empty": "暂无请求。网关启动后，客户端发来的每次调用都会记在这里（默认只记元数据，不记正文）。",
  "trae.gateway.log.col.time": "时间",
  "trae.gateway.log.col.account": "账号",
  "trae.gateway.log.col.model": "模型",
  "trae.gateway.log.col.status": "状态",
  "trae.gateway.log.col.latency": "耗时",
  "trae.gateway.log.col.tokens": "Token",

  // =====================================================================
  // gateway/trae-integration-guide.tsx —— 接入指引
  // =====================================================================
  "trae.gateway.guide.title": "接入指引",
  "trae.gateway.guide.copy": "复制代码",
  "trae.gateway.guide.copied": "代码已复制",
  "trae.gateway.guide.noKey": "sk-trae-…（请先在上方创建 Key）",
  "trae.gateway.guide.streamNote": "Trae 上游只支持流式；请求 `stream: false` 时由本网关在本地聚合后一次性返回，首字节延迟较长。",
  // 可复制配置片段里的字段标签（给外部工具粘贴用）
  "trae.gateway.guide.snippet.apiBase": "API 地址",
  "trae.gateway.guide.snippet.apiKey": "API 密钥",
  "trae.gateway.guide.snippet.model": "模型",

  // =====================================================================
  // 账号池卡已**两侧共用**（`gateway/account-pool-card.tsx`），文案随之迁到
  // `shared.gateway.pool.*` / `shared.poolStatus.*`（见 `shared.zh.ts`）。
  // =====================================================================

  // =====================================================================
  // gateway/trae-api-key-table.tsx —— API Key 列表 / 创建 / 吊销 / 删除
  // =====================================================================
  // ---- toast ----
  "trae.gateway.key.loadFailed": "读取 API Key 列表失败",
  "trae.gateway.key.nameRequired": "请填写名称",
  "trae.gateway.key.noPlaintext": "创建成功但未返回明文，请重试",
  "trae.gateway.key.createFailed": "创建失败",
  "trae.gateway.key.revoked": "已吊销",
  "trae.gateway.key.revokeFailed": "吊销失败",
  "trae.gateway.key.deleted": "已删除",
  "trae.gateway.key.deleteFailed": "删除失败",
  "trae.gateway.key.copied": "API Key 已复制",

  // ---- 列表 ----
  "trae.gateway.key.create": "创建 API Key",
  "trae.gateway.key.loading": "读取中…",
  "trae.gateway.key.empty": "尚未创建 API Key。",
  "trae.gateway.key.neverUsed": "从未使用",
  "trae.gateway.key.statusRevoked": "已吊销",
  "trae.gateway.key.statusActive": "启用",
  "trae.gateway.key.revoke": "吊销",
  "trae.gateway.key.delete": "删除",

  // ---- 表头 ----
  "trae.gateway.key.name": "名称",
  "trae.gateway.key.col.variant": "归属程序位",
  "trae.gateway.key.col.prefix": "前缀",
  "trae.gateway.key.col.createdAt": "创建时间",
  "trae.gateway.key.col.lastUsed": "最近使用",
  "trae.gateway.key.col.status": "状态",
  "trae.gateway.key.col.actions": "操作",

  // ---- 创建对话框 ----
  "trae.gateway.key.createDesc": "每个 Key 只能访问其归属程序位的模型与账号池 —— TraeWork 与 TraeCode 的可调模型不同。",
  "trae.gateway.key.namePlaceholder": "例如 Cursor",
  "trae.gateway.key.variant": "归属程序位",
  "trae.gateway.key.cancel": "取消",
  "trae.gateway.key.createSubmit": "创建",

  // ---- 一次性明文 ----
  "trae.gateway.key.createdTitle": "API Key 已创建",
  "trae.gateway.key.createdDesc": "完整 Key 只显示这一次，请立即复制保存。",
  "trae.gateway.key.copy": "复制",
  "trae.gateway.key.saved": "我已保存，关闭",

  // ---- 吊销 / 删除 确认 ----
  "trae.gateway.key.revokeTitle": "吊销 API Key",
  "trae.gateway.key.revokeDesc": "吊销后「{name}」立即失效（401），列表中保留为「已吊销」状态。",
  "trae.gateway.key.deleteTitle": "删除 API Key",
  "trae.gateway.key.deleteDesc": "确定删除已吊销的「{name}」？此操作不可撤销。",
} as const;
