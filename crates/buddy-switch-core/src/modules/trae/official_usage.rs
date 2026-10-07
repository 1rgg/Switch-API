//! Trae 官方积分用量投影（不经过本机网关的消耗也能查到）。
//!
//! ## 这个模块解决什么
//!
//! `trae/token_stats.rs` 只能看到**经过本机网关**的调用（网关日志是唯一诚实落盘）。
//! 于是在 Trae IDE / SOLO 客户端里直接对话产生的消耗，此前是**不可见**的。
//!
//! 但 Trae **官方**其实给了账号级的积分用量：`POST {account_base}` +
//! [`TRAE_ENTITLEMENT_PATH`]（`/trae/api/v2/pay/ide_user_ent_usage`）的响应里，
//! 除了逐包额度，还有一份 [`usage_summary`](UsageSummary)：
//!
//! ```json
//! { "usage_summary": { "consumed_amount": 821.65,
//!                      "total_amount": 3800,
//!                      "consumption_ratio": 0.2162 } }
//! ```
//!
//! 这份数字来自**上游账号账本**，与调用是否经过本机网关**无关**——这正是
//! 「非网关用量」的可查口径。
//!
//! ## 实测事实（2026-10-07，用真实账号直连 `api.trae.cn` 对照）
//!
//! - 请求体 `{}` 与 `{"require_usage":true,"full_data":true}` **返回完全一致**
//!   （都 200、都 25 个包、`usage_summary` 相同）→ 沿用 [credits::post_json] 的 `{}` 即可；
//! - 「消耗」的两个口径**精确自洽**：
//!   `usage_summary.consumed_amount` ≈ Σ 逐包 `usage.credits_amount`（实测相等）；
//! - **没有逐请求/逐日明细**：探测 8 个候选端点（`.../usage_detail`、`.../user_usage_list`
//!   等）全部 **404**。所以本模块的粒度是「账号级累计 + 逐包」，
//!   **不是** WorkBuddy 侧那种 requestId 级的逐条用量——那是 [`official_usage`] 的口径，
//!   两者形状刻意不同，不要强行对齐（会得到一堆恒为 0 的键）。
//!
//! ## 口径纪律
//!
//! - `consumed_amount` 是**账号生命周期累计**（不是「今日」/「近 7 天」）——
//!   上游没给时间维度，本模块**不编造**时间窗口，宁可如实标注「累计」；
//! - 逐包 `used` 以包为单位，可精确归因到「哪个签到包用掉了多少」，
//!   这是本模块相对 [`UsageSummary`] 的增量价值（账号卡进度条 + 包级归因）；
//! - `charge_amount > 0` 的包是**购买**得到，`= 0` 的是**赠送/签到**得到——
//!   与 [`credits::calc_remaining_credits`] 的「今日购买」口径同源。
//!
//! 参考：[`crate::modules::official_usage`]（WorkBuddy 的**逐请求**官方用量投影）。

use serde_json::{json, Value};

use super::credits;
use super::variant::TraeVariant;
use super::TRAE_ENTITLEMENT_PATH;

/// Trae 通用积分（签到 / 活动获取，各模型按倍率消耗）的 `product_id`。
///
/// 实测（2026-10-07）：25 个包里有 23 个是 208；另有 221（每月登录赠送）与
/// 0（展示占位，无 `credits_limit`）。Work 套餐积分是 **209**，与 208 相互独立。
pub const TRAE_PRODUCT_UNIVERSAL: i64 = 208;

/// 上游 `usage_summary` 的落点（三件套，全部为可选）。
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UsageSummary {
    /// 已消耗额度（账号生命周期累计）。
    pub consumed_amount: Option<f64>,
    /// 总额度（账本口径，实测 = Σ 逐包 `credits_limit`）。
    pub total_amount: Option<f64>,
    /// 消耗比例（`consumed / total`，上游直接给，避免本地再算一遍导致尾差）。
    pub consumption_ratio: Option<f64>,
}

impl UsageSummary {
    /// 从响应根对象解析（缺字段 → `None`，**不回落 0.0**——0 与「没有这个数」是两回事）。
    pub fn from_response(body: &Value) -> Self {
        let summary = body.get("usage_summary");
        Self {
            consumed_amount: number(summary, "consumed_amount"),
            total_amount: number(summary, "total_amount"),
            consumption_ratio: number(summary, "consumption_ratio"),
        }
    }

    /// 剩余额度 = `total - consumed`（两者都在时才有意义；下限 0）。
    pub fn remaining(&self) -> Option<f64> {
        match (self.total_amount, self.consumed_amount) {
            (Some(total), Some(consumed)) => Some((total - consumed).max(0.0)),
            _ => None,
        }
    }

    /// 是否拿到了任何有效数字。
    pub fn is_present(&self) -> bool {
        self.consumed_amount.is_some() || self.total_amount.is_some()
    }
}

/// 一个积分包的用量归因（比 [`credits::CreditPackage`] 多带产品线与来源）。
#[derive(Debug, Clone, PartialEq)]
pub struct PackageUsage {
    /// 人类可读包名（顶层 `display_desc`；实测这是唯一稳定的可读名）。
    pub name: Option<String>,
    /// 分组名（如「每日签到」「每月登录积分」，顶层 `group_name`）。
    pub group: Option<String>,
    /// `product_id`（208 通用 / 221 每月登录 / 0 占位）。
    pub product_id: Option<i64>,
    /// 包总额度。
    pub total: f64,
    /// 已用（`usage.credits_amount`，无 usage 视为 0）。
    pub used: f64,
    /// 剩余（`total - used`，下限 0）。
    pub remaining: f64,
    /// 是否购买获得（`charge_amount > 0`）。
    pub purchased: bool,
    /// 到期时间（Unix 秒）。
    pub expire_at: Option<i64>,
}

impl PackageUsage {
    /// 由响应解析逐包用量（纯函数，便于单测）。
    ///
    /// 只统计 `entitlement_base_info.quota.credits_limit` 存在的包（与
    /// [`credits::calc_remaining_credits`] 的聚合口径一致）：无上限的包是占位/无限制资源。
    pub fn parse_all(body: &Value) -> Vec<Self> {
        let Some(packs) = body
            .get("user_entitlement_pack_list")
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };
        packs
            .iter()
            .filter_map(|pack| {
                let base = pack.get("entitlement_base_info");
                let limit = base
                    .and_then(|info| info.get("quota"))
                    .and_then(|quota| quota.get("credits_limit"))
                    .and_then(Value::as_f64)?;
                let used = pack
                    .get("usage")
                    .and_then(|usage| usage.get("credits_amount"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                let charge_amount = base
                    .and_then(|info| info.get("charge_amount"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                Some(Self {
                    name: text(pack, "display_desc"),
                    group: text(pack, "group_name"),
                    product_id: base
                        .and_then(|info| info.get("product_id"))
                        .and_then(Value::as_i64),
                    total: credits::round2(limit),
                    used: credits::round2(used),
                    remaining: credits::round2((limit - used).max(0.0)),
                    purchased: charge_amount > 0,
                    expire_at: pack.get("expire_time").and_then(Value::as_i64),
                })
            })
            .collect()
    }
}

/// 一个账号的官方用量快照。
#[derive(Debug, Clone)]
pub struct AccountUsage {
    pub user_id: String,
    pub account_name: String,
    pub summary: UsageSummary,
    pub packages: Vec<PackageUsage>,
}

impl AccountUsage {
    /// 逐包已用之和（与上游 `consumed_amount` 互为校验）。
    pub fn packages_used_total(&self) -> f64 {
        credits::round2(self.packages.iter().map(|package| package.used).sum())
    }

    /// 逐包总额之和。
    pub fn packages_total(&self) -> f64 {
        credits::round2(self.packages.iter().map(|package| package.total).sum())
    }

    /// 只保留通用积分（208）的包——与 Trae 池的真实消耗口径一致。
    pub fn universal_packages(&self) -> Vec<&PackageUsage> {
        self.packages
            .iter()
            .filter(|package| package.product_id == Some(TRAE_PRODUCT_UNIVERSAL))
            .collect()
    }

    /// 序列化为线上形状（前端直接消费）。
    pub fn to_value(&self) -> Value {
        json!({
            "userId": self.user_id,
            "accountName": self.account_name,
            "consumedAmount": self.summary.consumed_amount,
            "totalAmount": self.summary.total_amount,
            "consumptionRatio": self.summary.consumption_ratio,
            "remaining": self.summary.remaining(),
            "packagesUsedTotal": self.packages_used_total(),
            "universal": self.universal_usage_value(),
            "packages": self.packages.iter().map(|package| json!({
                "name": package.name,
                "group": package.group,
                "productId": package.product_id,
                "total": package.total,
                "used": package.used,
                "remaining": package.remaining,
                "purchased": package.purchased,
                "expireAt": package.expire_at,
            })).collect::<Vec<_>>(),
        })
    }

    /// 通用积分（208）一档的汇总。
    fn universal_usage_value(&self) -> Value {
        let packages = self.universal_packages();
        let total: f64 = packages.iter().map(|package| package.total).sum();
        let used: f64 = packages.iter().map(|package| package.used).sum();
        json!({
            "total": credits::round2(total),
            "used": credits::round2(used),
            "remaining": credits::round2((total - used).max(0.0)),
            "packageCount": packages.len(),
        })
    }
}

/// 指定账号的官方用量（异步：直连上游）。
///
/// 由 JWT 派生设备身份（`credits::device_for_jwt`），逐字节复用
/// [`credits::post_json`] 的请求构造（含 `{}` 请求体与 19 个固定头）。
pub async fn account_usage(
    variant: TraeVariant,
    user_id: &str,
    account_name: &str,
    jwt_value: &str,
) -> Result<AccountUsage, String> {
    let device = credits::device_for_jwt_for(variant, jwt_value)?;
    let (status, body) = credits::post_json_for(variant, TRAE_ENTITLEMENT_PATH, jwt_value, &device)
        .await;
    if status == 0 {
        return Err(body);
    }
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|_| format!("HTTP {status}: 非 JSON 响应: {}", truncate(&body, 200)))?;
    Ok(AccountUsage {
        user_id: user_id.to_string(),
        account_name: account_name.to_string(),
        summary: UsageSummary::from_response(&parsed),
        packages: PackageUsage::parse_all(&parsed),
    })
}

/// 从响应 JSON 构造（纯函数——供测试与缓存回放，避免测网络）。
pub fn account_usage_from_response(
    user_id: &str,
    account_name: &str,
    body: &Value,
) -> AccountUsage {
    AccountUsage {
        user_id: user_id.to_string(),
        account_name: account_name.to_string(),
        summary: UsageSummary::from_response(body),
        packages: PackageUsage::parse_all(body),
    }
}

fn number(value: Option<&Value>, key: &str) -> Option<f64> {
    value.and_then(|object| object.get(key)).and_then(as_f64)
}

/// 宽容取数：数字与数字字符串都认（上游偶有字符串化数字）。
fn as_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
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

fn truncate(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一个贴近实测形状的响应（两包：一个签到赠送、一个购买）。
    fn sample_response() -> Value {
        json!({
            "usage_summary": {
                "consumed_amount": 821.65,
                "total_amount": 3800,
                "consumption_ratio": 0.21622368421052632,
            },
            "is_credits_billing": true,
            "user_entitlement_pack_list": [
                {
                    "display_desc": "签到奖励",
                    "group_name": "每日签到",
                    "entitlement_base_info": {
                        "product_id": 208,
                        "charge_amount": 0,
                        "quota": { "credits_limit": 150 },
                    },
                    "usage": { "credits_amount": 71.6488 },
                    "expire_time": 1791850991,
                },
                {
                    "display_desc": "购买套餐",
                    "group_name": "订阅",
                    "entitlement_base_info": {
                        "product_id": 208,
                        "charge_amount": 3000,
                        "quota": { "credits_limit": 500 },
                    },
                    "expire_time": 1793462399,
                },
                // 无额度上限的占位包 → 不进明细。
                {
                    "display_desc": "免费",
                    "entitlement_base_info": { "product_id": 0, "quota": {} },
                },
            ],
        })
    }

    #[test]
    fn summary_parses_and_derives_remaining() {
        let summary = UsageSummary::from_response(&sample_response());
        assert_eq!(summary.consumed_amount, Some(821.65));
        assert_eq!(summary.total_amount, Some(3800.0));
        assert_eq!(summary.remaining(), Some(2978.35));
        assert!(summary.is_present());
    }

    #[test]
    fn summary_missing_fields_are_none_not_zero() {
        // 0 与「没有这个数」必须区分：缺字段 → None，绝不回落 0.0。
        let summary = UsageSummary::from_response(&json!({}));
        assert_eq!(summary.consumed_amount, None);
        assert_eq!(summary.total_amount, None);
        assert_eq!(summary.remaining(), None);
        assert!(!summary.is_present());
    }

    #[test]
    fn packages_parse_name_group_and_purchased_flag() {
        let packages = PackageUsage::parse_all(&sample_response());
        assert_eq!(packages.len(), 2, "无额度上限的占位包应被跳过");
        assert_eq!(packages[0].name.as_deref(), Some("签到奖励"));
        assert_eq!(packages[0].group.as_deref(), Some("每日签到"));
        assert_eq!(packages[0].product_id, Some(208));
        assert_eq!(packages[0].total, 150.0);
        assert_eq!(packages[0].used, 71.65);
        assert_eq!(packages[0].remaining, 78.35);
        assert!(!packages[0].purchased, "charge_amount=0 → 赠送，非购买");
        assert!(packages[1].purchased, "charge_amount>0 → 购买");
        assert_eq!(packages[1].used, 0.0, "无 usage → 视为已用 0");
    }

    #[test]
    fn account_usage_separates_universal_product() {
        let usage = account_usage_from_response("u1", "名字", &sample_response());
        assert_eq!(usage.user_id, "u1");
        assert_eq!(usage.universal_packages().len(), 2, "两包都是 208");
        // 逐包已用之和应能与上游 consumed_amount 对照（这里只是自洽性）。
        assert_eq!(usage.packages_used_total(), 71.65);
        assert_eq!(usage.packages_total(), 650.0);
    }

    #[test]
    fn account_usage_value_shape_is_camel_case() {
        let value = account_usage_from_response("u1", "名字", &sample_response()).to_value();
        for key in [
            "userId",
            "accountName",
            "consumedAmount",
            "totalAmount",
            "consumptionRatio",
            "remaining",
            "packagesUsedTotal",
            "universal",
            "packages",
        ] {
            assert!(value.get(key).is_some(), "缺少线上键 {key}");
        }
        assert_eq!(value["universal"]["packageCount"], 2);
        assert_eq!(value["universal"]["used"], 71.65);
        assert_eq!(value["packages"][0]["name"], "签到奖励");
        // 序列化后不得出现 snake_case 漏网。
        assert!(value.get("consumed_amount").is_none());
    }

    #[test]
    fn empty_response_yields_empty_but_valid_projection() {
        let usage = account_usage_from_response("u1", "n", &json!({}));
        assert!(!usage.summary.is_present());
        assert!(usage.packages.is_empty());
        assert_eq!(usage.packages_used_total(), 0.0);
        let value = usage.to_value();
        assert_eq!(value["consumedAmount"], Value::Null);
        assert_eq!(value["packages"].as_array().map(Vec::len), Some(0));
    }
}
