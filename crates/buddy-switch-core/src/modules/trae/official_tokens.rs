//! Trae **官方 Token 用量**（agent 域会话 API + 逐轮计费用量）。
//!
//! ## 这个模块解决什么
//!
//! [`super::token_stats`] 只能看到**经过本机网关**的调用（网关日志是唯一诚实落盘）。
//! 在 Trae IDE / SOLO 客户端里直接对话产生的 token，此前**完全不可见**。
//!
//! 官方其实有 token 口径，但它**不在**账号域的积分接口里（[`super::credits`] 的
//! `ide_user_ent_usage` 只有积分，实测 69 个键里没有任何 token 字段）。要拿 token，
//! 必须走 **agent 域**（`agent_host`）的会话 API：
//!
//! ```text
//! GET  {agent_host}/api/remote/v1/projects
//! POST {agent_host}/api/remote/v1/chat_sessions/batch_by_project   {"local_project_ids":[…]}
//! GET  {agent_host}/api/remote/v1/chat_sessions/{session_id}/messages
//! POST {agent_host}/api/v1/commercial/get_session_usage            {"session_id":"<userMessageId>"}
//! ```
//!
//! 前三个调用负责**枚举**（项目 → 会话 → 消息 id），最后一个给出该轮的用量：
//!
//! ```json
//! { "user_usage_group_by_session": {
//!     "credits_float": 9.08,
//!     "cost_money_float": 0.23,
//!     "extra_info": { "input_token": 302612, "output_token": 9525,
//!                     "cache_read_token": 258560, "cache_write_token": 0 },
//!     "model_name": "DeepSeek-V4-Flash 正式版",
//!     "user_input_preview": "定时任务：获取当天 IT 行业重要资讯并"
//! } }
//! ```
//!
//! ## 实测事实（2026-10-08，真实账号对照）
//!
//! - **参数是 `userMessageId`，不是会话 id** —— 这是最容易踩的坑。客户端源码
//!   （`@byted-icube/solo-lite` 的 `[SessionBarPort] getCnSessionUsage`）里
//!   `let t = e.userMessageId; … body: JSON.stringify({session_id: t})`，
//!   即字段名叫 `session_id` 但装的是**消息 id**。传会话 id 只会拿到全零骨架。
//! - 传未知 id **不报错**，而是返回一份「结构完整但全零、`session_id` 为空」的骨架。
//!   因此**不能**靠返回值判断 id 对不对，只能自己保证 id 来自消息列表。
//! - `input_token` 是**该轮所有 LLM 调用之和**（含工具循环），**远大于**单条消息
//!   `token_usage.prompt_tokens`（实测 302612 vs 40024 左右，约 5 倍）。两者口径不同：
//!   本模块取的是**计费口径**（与 `credits_float` 同源）。
//! - 逐请求/逐日端点不存在：探测 20 个候选路径**全部 404**；官方只有这一条 token 链路。
//!
//! ## 口径纪律
//!
//! - **没有时间维度**：上游不给逐日聚合，本模块按**消息创建时间**自行分日，
//!   并在界面上如实标注「按会话消息时间归档」；
//! - 粒度是「**每条用户消息（一轮）**」，一个会话可有多轮；
//! - `null` ≠ `0`：上游没给数的轮次不进聚合分母，也不计 0。

use serde_json::{json, Value};

use super::credits;
use super::device::DeviceEntry;
use super::variant::TraeVariant;

/// 项目列表路径（agent 域）。
pub const TRAE_AGENT_PROJECTS_PATH: &str = "/api/remote/v1/projects";

/// 按项目批量列会话（agent 域）。请求体 `{"local_project_ids":[…]}`。
pub const TRAE_AGENT_SESSIONS_BY_PROJECT_PATH: &str =
    "/api/remote/v1/chat_sessions/batch_by_project";

/// 逐轮用量路径（agent 域）。请求体 `{"session_id":"<userMessageId>"}`。
pub const TRAE_AGENT_TURN_USAGE_PATH: &str = "/api/v1/commercial/get_session_usage";

/// 默认扫描窗口（天）。
pub const DEFAULT_DAYS: i64 = 7;

/// 默认最多扫描的会话数（按最近活跃排序后截断）。
pub const DEFAULT_MAX_SESSIONS: usize = 20;

/// 默认最多查询的轮次数。
pub const DEFAULT_MAX_TURNS: usize = 200;

/// 逐轮请求的并发批大小（控制上游压力，避免一次打出上百个请求）。
const TURN_BATCH: usize = 6;

// ---------------------------------------------------------------------------
// 上游请求
// ---------------------------------------------------------------------------

/// 向 **agent 域**发一个请求并解析为 JSON。
///
/// 复用 [`credits::build_headers`] 与 [`credits::trae_http_client`]（`no_proxy()`）——
/// agent 域与账号域共用同一套鉴权头，实测两者都接受同一个 `Cloud-IDE-JWT`。
async fn agent_request(
    base: &str,
    method: reqwest::Method,
    path: &str,
    jwt_value: &str,
    device: &DeviceEntry,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("{base}{path}");
    let mut request = credits::trae_http_client().request(method, &url);
    for (key, value) in credits::build_headers(jwt_value, device) {
        request = request.header(key, value);
    }
    if let Some(payload) = body {
        request = request.body(payload.to_string());
    }
    let response = request
        .send()
        .await
        .map_err(|error| crate::modules::net::transport_error(&error).to_wire())?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|_| format!("HTTP {status}: 非 JSON 响应: {}", truncate(&text, 200)))?;
    // `{code,message,data}` 信封：code != 0 视为失败。
    // ⚠️ `get_session_usage` **没有** `code` 字段（`unwrap_or(0)` 正好兼容）。
    let code = parsed.get("code").and_then(Value::as_i64).unwrap_or(0);
    if code != 0 {
        let message = parsed
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("上游返回非零 code");
        return Err(format!("上游 code={code}: {message}"));
    }
    Ok(parsed)
}

/// 取 `{code,message,data}` 信封里的 `data`（无 `data` 时返回根对象）。
fn envelope_data(value: &Value) -> &Value {
    value.get("data").unwrap_or(value)
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/// 一个 SOLO 项目（`GET /api/remote/v1/projects`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    pub local_project_id: String,
    pub remote_project_id: Option<String>,
    pub name: Option<String>,
    pub mode: Option<String>,
}

impl Project {
    fn from_value(value: &Value) -> Option<Self> {
        let local_project_id = text(value, "local_project_id")?;
        Some(Self {
            local_project_id,
            remote_project_id: text(value, "remote_project_id"),
            name: text(value, "name"),
            mode: text(value, "mode"),
        })
    }
}

/// 一个会话（`batch_by_project` 的条目）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRef {
    pub chat_session_id: String,
    pub title: Option<String>,
    pub mode: Option<String>,
    pub local_project_id: Option<String>,
    /// 最近更新时间（Unix 毫秒）。
    pub updated_at_ms: Option<i64>,
}

impl SessionRef {
    fn from_value(value: &Value, local_project_id: Option<&str>) -> Option<Self> {
        let chat_session_id = text(value, "chat_session_id")?;
        Some(Self {
            chat_session_id,
            title: text(value, "title"),
            mode: text(value, "mode"),
            local_project_id: local_project_id.map(str::to_string),
            updated_at_ms: number_i64(value, "updated_at"),
        })
    }
}

/// 一轮（一条用户消息）的 token 用量。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TurnTokens {
    /// 输入 token（**该轮所有 LLM 调用之和**）。
    pub input: f64,
    /// 输出 token。
    pub output: f64,
    /// 命中缓存的输入 token（`input` 的子集）。
    pub cache_read: f64,
    /// 写入缓存的输入 token。
    pub cache_write: f64,
}

impl TurnTokens {
    /// 输入 + 输出（缓存读写不另加，它们是 `input` 的拆分）。
    pub fn total(&self) -> f64 {
        self.input + self.output
    }

    fn add(&mut self, other: &Self) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
    }
}

/// 一轮用量的完整记录。
#[derive(Debug, Clone, PartialEq)]
pub struct TurnUsage {
    pub message_id: String,
    pub session_id: Option<String>,
    /// 所属会话标题（来自会话列表，用量接口不给）。
    pub session_title: Option<String>,
    pub model: Option<String>,
    pub tokens: TurnTokens,
    pub credits: Option<f64>,
    pub money: Option<f64>,
    pub preview: Option<String>,
    /// 该轮所属用户的输入时间（Unix 毫秒，来自消息列表）。
    pub at_ms: Option<i64>,
}

impl TurnUsage {
    fn from_response(message_id: &str, value: &Value) -> Self {
        let group = value.get("user_usage_group_by_session").unwrap_or(&Value::Null);
        let extra = group.get("extra_info");
        Self {
            message_id: message_id.to_string(),
            session_id: text(group, "session_id"),
            session_title: None,
            model: text(group, "model_name"),
            tokens: TurnTokens {
                input: number(extra, "input_token").unwrap_or(0.0),
                output: number(extra, "output_token").unwrap_or(0.0),
                cache_read: number(extra, "cache_read_token").unwrap_or(0.0),
                cache_write: number(extra, "cache_write_token").unwrap_or(0.0),
            },
            credits: number(group, "credits_float").or_else(|| number(group, "amount_float")),
            money: number(group, "cost_money_float"),
            preview: text(group, "user_input_preview"),
            at_ms: None,
        }
    }

    /// 是否拿到了任何 token（全零=上游不认识这个 id，属**无效样本**）。
    fn has_tokens(&self) -> bool {
        self.tokens.total() > 0.0
    }
}

// ---------------------------------------------------------------------------
// 枚举（agent 域）
// ---------------------------------------------------------------------------

/// 列出该账号的全部 SOLO 项目。
pub async fn list_projects(
    variant: TraeVariant,
    jwt_value: &str,
    device: &DeviceEntry,
) -> Result<Vec<Project>, String> {
    let base = super::endpoints_for(variant).agent_host;
    let value = agent_request(
        base,
        reqwest::Method::GET,
        TRAE_AGENT_PROJECTS_PATH,
        jwt_value,
        device,
        None,
    )
    .await?;
    Ok(value
        .pointer("/data/items")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Project::from_value).collect())
        .unwrap_or_default())
}

/// 按项目批量列会话（一次请求拿多个项目）。
pub async fn list_sessions(
    variant: TraeVariant,
    jwt_value: &str,
    device: &DeviceEntry,
    project_ids: &[String],
) -> Result<Vec<SessionRef>, String> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }
    let base = super::endpoints_for(variant).agent_host;
    let value = agent_request(
        base,
        reqwest::Method::POST,
        TRAE_AGENT_SESSIONS_BY_PROJECT_PATH,
        jwt_value,
        device,
        Some(json!({ "local_project_ids": project_ids })),
    )
    .await?;
    let mut sessions = Vec::new();
    if let Some(results) = envelope_data(&value).get("results").and_then(Value::as_object) {
        for (project_id, block) in results {
            let Some(items) = block.get("items").and_then(Value::as_array) else {
                continue;
            };
            for item in items {
                if let Some(session) = SessionRef::from_value(item, Some(project_id.as_str())) {
                    sessions.push(session);
                }
            }
        }
    }
    Ok(sessions)
}

/// 列出一个会话里**用户消息**的 id（这些 id 才是用量接口要的 key）。
///
/// 返回 `(message_id, created_at_ms)`。助手消息不带 token key，直接跳过。
pub async fn list_user_turns(
    variant: TraeVariant,
    jwt_value: &str,
    device: &DeviceEntry,
    session_id: &str,
) -> Result<Vec<(String, Option<i64>)>, String> {
    let base = super::endpoints_for(variant).agent_host;
    let path = format!("/api/remote/v1/chat_sessions/{session_id}/messages");
    let value = agent_request(base, reqwest::Method::GET, &path, jwt_value, device, None).await?;
    let Some(items) = value.pointer("/data/items").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    Ok(items
        .iter()
        .filter(|item| {
            item.get("role")
                .and_then(Value::as_str)
                .map(|role| role.eq_ignore_ascii_case("user"))
                .unwrap_or(false)
        })
        .filter_map(|item| Some((text(item, "message_id")?, number_i64(item, "created_at"))))
        .collect())
}

/// 查一轮（一条用户消息）的用量。
pub async fn turn_usage(
    variant: TraeVariant,
    jwt_value: &str,
    device: &DeviceEntry,
    message_id: &str,
) -> Result<TurnUsage, String> {
    let base = super::endpoints_for(variant).agent_host;
    let value = agent_request(
        base,
        reqwest::Method::POST,
        TRAE_AGENT_TURN_USAGE_PATH,
        jwt_value,
        device,
        Some(json!({ "session_id": message_id })),
    )
    .await?;
    Ok(TurnUsage::from_response(message_id, &value))
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

/// 模型维度的汇总。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelAgg {
    pub model: String,
    pub turns: usize,
    pub tokens: TurnTokens,
    pub credits: f64,
}

/// 会话维度的汇总。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionAgg {
    pub session_id: String,
    pub title: Option<String>,
    pub turns: usize,
    pub tokens: TurnTokens,
    pub credits: f64,
    pub last_at_ms: Option<i64>,
}

/// 扫描统计（用于如实告诉用户「扫了多少」）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScanStats {
    pub projects: usize,
    pub sessions: usize,
    pub turns: usize,
    pub requests: usize,
    /// 是否因为上限而截断。
    pub truncated: bool,
}

/// 一个账号的官方 token 用量。
#[derive(Debug, Clone, Default)]
pub struct AccountTokens {
    pub user_id: String,
    pub account_name: String,
    pub turns: Vec<TurnUsage>,
    pub scan: ScanStats,
    pub errors: Vec<String>,
}

impl AccountTokens {
    /// 逐轮有数之和。
    pub fn totals(&self) -> TurnTokens {
        let mut sum = TurnTokens::default();
        for turn in &self.turns {
            sum.add(&turn.tokens);
        }
        sum
    }

    /// 模型维度汇总（按 token 降序）。
    pub fn by_model(&self) -> Vec<ModelAgg> {
        let mut map: std::collections::HashMap<String, ModelAgg> = std::collections::HashMap::new();
        for turn in &self.turns {
            let key = turn
                .model
                .clone()
                .unwrap_or_else(|| "未知模型".to_string());
            let entry = map.entry(key.clone()).or_insert_with(|| ModelAgg {
                model: key,
                ..Default::default()
            });
            entry.turns += 1;
            entry.tokens.add(&turn.tokens);
            entry.credits += turn.credits.unwrap_or(0.0);
        }
        let mut out: Vec<ModelAgg> = map.into_values().collect();
        out.sort_by(|a, b| {
            b.tokens
                .total()
                .partial_cmp(&a.tokens.total())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out
    }

    /// 会话维度汇总（按最近活跃降序）。
    pub fn by_session(&self) -> Vec<SessionAgg> {
        let mut map: std::collections::HashMap<String, SessionAgg> =
            std::collections::HashMap::new();
        for turn in &self.turns {
            let key = turn.session_id.clone().unwrap_or_else(|| "?".to_string());
            let entry = map.entry(key.clone()).or_insert_with(|| SessionAgg {
                session_id: key,
                ..Default::default()
            });
            entry.turns += 1;
            entry.tokens.add(&turn.tokens);
            entry.credits += turn.credits.unwrap_or(0.0);
            if entry.title.is_none() {
                entry.title = turn.session_title.clone();
            }
            if turn.at_ms > entry.last_at_ms {
                entry.last_at_ms = turn.at_ms;
            }
        }
        let mut out: Vec<SessionAgg> = map.into_values().collect();
        out.sort_by(|a, b| b.last_at_ms.cmp(&a.last_at_ms));
        out
    }

    /// 按**消息时间**分日（上游无时间维度，这是本地归档口径）。
    pub fn by_day(&self) -> Vec<(String, TurnTokens, f64, usize)> {
        let mut map: std::collections::BTreeMap<String, (TurnTokens, f64, usize)> =
            std::collections::BTreeMap::new();
        for turn in &self.turns {
            let Some(date) = local_date(turn.at_ms) else {
                continue;
            };
            let entry = map.entry(date).or_insert_with(|| (TurnTokens::default(), 0.0, 0));
            entry.0.add(&turn.tokens);
            entry.1 += turn.credits.unwrap_or(0.0);
            entry.2 += 1;
        }
        map.into_iter()
            .map(|(date, (tokens, credits, turns))| (date, tokens, credits, turns))
            .collect()
    }

    /// 序列化为线上形状（camelCase，前端直接消费）。
    pub fn to_value(&self) -> Value {
        let totals = self.totals();
        let total_credits: f64 = self.turns.iter().filter_map(|turn| turn.credits).sum();
        json!({
            "userId": self.user_id,
            "accountName": self.account_name,
            "totals": {
                "inputTokens": credits::round2(totals.input),
                "outputTokens": credits::round2(totals.output),
                "cacheReadTokens": credits::round2(totals.cache_read),
                "cacheWriteTokens": credits::round2(totals.cache_write),
                "totalTokens": credits::round2(totals.total()),
                "credits": credits::round2(total_credits),
                "turns": self.turns.len(),
            },
            "models": self.by_model().iter().map(|entry| json!({
                "model": entry.model,
                "turns": entry.turns,
                "inputTokens": credits::round2(entry.tokens.input),
                "outputTokens": credits::round2(entry.tokens.output),
                "totalTokens": credits::round2(entry.tokens.total()),
                "credits": credits::round2(entry.credits),
            })).collect::<Vec<_>>(),
            "sessions": self.by_session().iter().map(|entry| json!({
                "sessionId": entry.session_id,
                "title": entry.title,
                "turns": entry.turns,
                "totalTokens": credits::round2(entry.tokens.total()),
                "credits": credits::round2(entry.credits),
                "lastAt": entry.last_at_ms,
            })).collect::<Vec<_>>(),
            "daily": self.by_day().iter().map(|(date, tokens, day_credits, turns)| json!({
                "date": date,
                "inputTokens": credits::round2(tokens.input),
                "outputTokens": credits::round2(tokens.output),
                "totalTokens": credits::round2(tokens.total()),
                "credits": credits::round2(*day_credits),
                "turns": turns,
            })).collect::<Vec<_>>(),
            "recent": self.turns.iter().take(50).map(|turn| json!({
                "messageId": turn.message_id,
                "sessionId": turn.session_id,
                "model": turn.model,
                "inputTokens": credits::round2(turn.tokens.input),
                "outputTokens": credits::round2(turn.tokens.output),
                "cacheReadTokens": credits::round2(turn.tokens.cache_read),
                "totalTokens": credits::round2(turn.tokens.total()),
                "credits": turn.credits,
                "at": turn.at_ms,
                "preview": turn.preview,
            })).collect::<Vec<_>>(),
            "scan": {
                "projects": self.scan.projects,
                "sessions": self.scan.sessions,
                "turns": self.scan.turns,
                "requests": self.scan.requests,
                "truncated": self.scan.truncated,
            },
            "errors": self.errors,
        })
    }
}

/// 扫描参数。
#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    /// 只看最近 N 天活跃的会话。
    pub days: i64,
    /// 最多扫描的会话数。
    pub max_sessions: usize,
    /// 最多查询的轮次数。
    pub max_turns: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            days: DEFAULT_DAYS,
            max_sessions: DEFAULT_MAX_SESSIONS,
            max_turns: DEFAULT_MAX_TURNS,
        }
    }
}

/// 扫描一个账号的官方 token 用量。
///
/// 流程：项目 → 会话（按窗口与上限截断）→ 逐会话拉消息取用户消息 id → 逐轮查用量（分批并发）。
/// **单个会话失败不中断整体**（记进 `errors`），因为会话历史可能被删或权限受限。
pub async fn account_tokens(
    variant: TraeVariant,
    user_id: &str,
    account_name: &str,
    jwt_value: &str,
    options: ScanOptions,
) -> Result<AccountTokens, String> {
    let device = credits::device_for_jwt_for(variant, jwt_value)?;
    let mut account = AccountTokens {
        user_id: user_id.to_string(),
        account_name: account_name.to_string(),
        ..Default::default()
    };

    let projects = list_projects(variant, jwt_value, &device).await?;
    account.scan.projects = projects.len();
    account.scan.requests += 1;
    let project_ids: Vec<String> = projects
        .iter()
        .map(|project| project.local_project_id.clone())
        .collect();

    let mut sessions = list_sessions(variant, jwt_value, &device, &project_ids).await?;
    account.scan.requests += 1;

    // 窗口过滤（上游不给时间维度，只能按会话最近活跃时间粗筛）。
    let cutoff_ms = (chrono::Local::now() - chrono::Duration::days(options.days.max(1)))
        .timestamp_millis();
    sessions.retain(|session| session.updated_at_ms.map(|at| at >= cutoff_ms).unwrap_or(true));
    sessions.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    if sessions.len() > options.max_sessions {
        sessions.truncate(options.max_sessions);
        account.scan.truncated = true;
    }
    account.scan.sessions = sessions.len();

    // 会话 → 用户消息 id
    let mut turns: Vec<TurnRef> = Vec::new();
    for session in &sessions {
        account.scan.requests += 1;
        match list_user_turns(variant, jwt_value, &device, &session.chat_session_id).await {
            Ok(ids) => {
                for (message_id, at_ms) in ids {
                    turns.push(TurnRef {
                        message_id,
                        session_id: session.chat_session_id.clone(),
                        session_title: session.title.clone(),
                        at_ms,
                    });
                }
            }
            Err(error) => account.errors.push(format!(
                "会话 {} 消息读取失败: {error}",
                session.chat_session_id
            )),
        }
        if turns.len() >= options.max_turns {
            account.scan.truncated = true;
            break;
        }
    }
    turns.truncate(options.max_turns);

    // 逐轮用量（分批并发；单批内并行，批间串行 —— 既有速度又不会一次打爆上游）
    for chunk in turns.chunks(TURN_BATCH) {
        let mut set = tokio::task::JoinSet::new();
        for reference in chunk {
            let message_id = reference.message_id.clone();
            let session_id = Some(reference.session_id.clone());
            let session_title = reference.session_title.clone();
            let at_ms = reference.at_ms;
            let jwt_owned = jwt_value.to_string();
            let device_owned = device.clone();
            set.spawn(async move {
                let result = turn_usage(variant, &jwt_owned, &device_owned, &message_id).await;
                (message_id, session_id, session_title, at_ms, result)
            });
        }
        while let Some(joined) = set.join_next().await {
            account.scan.requests += 1;
            let Ok((message_id, session_id, session_title, at_ms, result)) = joined else {
                account.errors.push("轮次查询任务异常退出".to_string());
                continue;
            };
            match result {
                Ok(mut turn) => {
                    turn.session_id = session_id.or(turn.session_id);
                    turn.session_title = session_title;
                    turn.at_ms = at_ms;
                    // 全零 = 上游不认识这个 id（骨架响应），不入账。
                    if turn.has_tokens() {
                        account.scan.turns += 1;
                        account.turns.push(turn);
                    }
                }
                Err(error) => account
                    .errors
                    .push(format!("消息 {message_id} 用量查询失败: {error}")),
            }
        }
    }

    Ok(account)
}

/// 待查询的一轮（会话消息枚举的结果）。
#[derive(Debug, Clone)]
struct TurnRef {
    message_id: String,
    session_id: String,
    session_title: Option<String>,
    at_ms: Option<i64>,
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

fn number(value: Option<&Value>, key: &str) -> Option<f64> {
    value.and_then(|object| object.get(key)).and_then(as_f64)
}

/// 宽容取数：数字与数字字符串都认（上游有大量字符串化数字）。
fn as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn number_i64(value: &Value, key: &str) -> Option<i64> {
    match value.get(key) {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(text)) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 毫秒时间戳 → 本地日期 `YYYY-MM-DD`。
fn local_date(at_ms: Option<i64>) -> Option<String> {
    use chrono::TimeZone;
    let at_ms = at_ms?;
    chrono::Local
        .timestamp_millis_opt(at_ms)
        .single()
        .map(|time| time.format("%Y-%m-%d").to_string())
}

fn truncate(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_usage() -> Value {
        json!({
            "user_usage_group_by_session": {
                "amount_float": 9.08,
                "cost_money_float": 0.23,
                "credits_float": 9.08,
                "extra_info": {
                    "cache_read_token": 258560,
                    "cache_write_token": 0,
                    "input_token": 302612,
                    "output_token": 9525
                },
                "model_name": "DeepSeek-V4-Flash 正式版",
                "session_id": "6ac6e87947543a79e275cd2c",
                "user_input_preview": "定时任务：获取当天 IT 行业重要资讯并"
            }
        })
    }

    #[test]
    fn turn_usage_reads_tokens_credits_and_model() {
        let turn = TurnUsage::from_response("msg-1", &sample_usage());
        assert_eq!(turn.tokens.input, 302612.0);
        assert_eq!(turn.tokens.output, 9525.0);
        assert_eq!(turn.tokens.cache_read, 258560.0);
        assert_eq!(turn.tokens.cache_write, 0.0);
        assert_eq!(turn.tokens.total(), 312137.0);
        assert_eq!(turn.credits, Some(9.08));
        assert_eq!(turn.money, Some(0.23));
        assert_eq!(turn.model.as_deref(), Some("DeepSeek-V4-Flash 正式版"));
        assert!(turn.has_tokens());
    }

    /// 骨架响应（全零 + 空 session_id）= 上游不认识该 id，必须**不入账**。
    #[test]
    fn skeleton_response_is_not_counted_as_usage() {
        let skeleton = json!({
            "user_usage_group_by_session": {
                "amount_float": 0,
                "credits_float": 0,
                "extra_info": {
                    "cache_read_token": 0, "cache_write_token": 0,
                    "input_token": 0, "output_token": 0
                },
                "model_name": "", "session_id": ""
            }
        });
        let turn = TurnUsage::from_response("nope", &skeleton);
        assert!(!turn.has_tokens(), "全零骨架不得算作有效轮次");
        // 空字符串的 model/session_id 应被规范成 None，而不是空串。
        assert_eq!(turn.model, None);
        assert_eq!(turn.session_id, None);
    }

    #[test]
    fn envelope_data_unwraps_code_message_data() {
        let value = json!({"code": 0, "message": "success", "data": {"items": [1, 2]}});
        assert_eq!(envelope_data(&value)["items"].as_array().map(Vec::len), Some(2));
        // 无 data 时返回根对象（get_session_usage 就是这种形状）。
        let raw = sample_usage();
        assert_eq!(envelope_data(&raw), &raw);
    }

    #[test]
    fn project_and_session_parse_skip_missing_ids() {
        let project = Project::from_value(&json!({
            "local_project_id": "st_M644TMBOM_HF1O",
            "remote_project_id": "rp_6a8e4ba8905b89c57b5855dd",
            "name": "天气预报",
            "mode": "work"
        }));
        assert_eq!(project.unwrap().name.as_deref(), Some("天气预报"));
        assert!(Project::from_value(&json!({"name": "无 id"})).is_none());

        let session =
            SessionRef::from_value(&json!({"chat_session_id": "abc", "updated_at": "1788144584992"}), Some("st_x"));
        let session = session.unwrap();
        assert_eq!(session.updated_at_ms, Some(1788144584992));
        assert_eq!(session.local_project_id.as_deref(), Some("st_x"));
        assert!(SessionRef::from_value(&json!({"title": "无 id"}), None).is_none());
    }

    #[test]
    fn aggregation_groups_by_model_session_and_day() {
        let mut account = AccountTokens {
            user_id: "u1".into(),
            account_name: "主号".into(),
            ..Default::default()
        };
        let mut first = TurnUsage::from_response("m1", &sample_usage());
        first.session_id = Some("s1".into());
        first.at_ms = Some(1_760_000_000_000);
        let mut second = first.clone();
        second.message_id = "m2".into();
        second.model = Some("GLM-5.2".into());
        second.tokens = TurnTokens { input: 100.0, output: 20.0, ..Default::default() };
        second.credits = Some(1.0);
        account.turns = vec![first, second];

        let totals = account.totals();
        assert_eq!(totals.input, 302712.0);
        assert_eq!(totals.output, 9545.0);

        let models = account.by_model();
        assert_eq!(models.len(), 2);
        // 按 token 降序：DeepSeek 那轮远大于 GLM 那轮。
        assert_eq!(models[0].model, "DeepSeek-V4-Flash 正式版");
        assert_eq!(models[0].turns, 1);
        assert_eq!(models[0].credits, 9.08);

        let sessions = account.by_session();
        assert_eq!(sessions.len(), 1, "两轮同属 s1");
        assert_eq!(sessions[0].turns, 2);

        let days = account.by_day();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].3, 2, "同一天两轮");
    }

    #[test]
    fn value_shape_is_camel_case() {
        let account = AccountTokens {
            user_id: "u1".into(),
            account_name: "主号".into(),
            turns: vec![TurnUsage::from_response("m1", &sample_usage())],
            ..Default::default()
        };
        let value = account.to_value();
        for key in [
            "userId", "accountName", "totals", "models", "sessions", "daily", "recent", "scan",
        ] {
            assert!(value.get(key).is_some(), "缺少线上键 {key}");
        }
        assert_eq!(value["totals"]["inputTokens"], 302612.0);
        assert_eq!(value["totals"]["turns"], 1);
        assert_eq!(value["recent"][0]["model"], "DeepSeek-V4-Flash 正式版");
        assert!(value.get("total_tokens").is_none(), "不得漏出 snake_case");
    }

    #[test]
    fn unknown_model_falls_back_to_readable_label() {
        let mut turn = TurnUsage::from_response("m1", &sample_usage());
        turn.model = None;
        let account = AccountTokens {
            turns: vec![turn],
            ..Default::default()
        };
        assert_eq!(account.by_model()[0].model, "未知模型");
    }
}
