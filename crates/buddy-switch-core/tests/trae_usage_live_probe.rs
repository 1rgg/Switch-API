//! 实测：Trae 官方用量 / 权益接口（`ide_user_ent_usage`）到底返回什么。
//!
//! ## 为什么单独开一个文件
//!
//! `trae_ent_usage_probe.rs` 只回答「请求体该发 `{}` 还是 `{require_usage,full_data}`」。
//! 本文件回答**更大的问题**：这个接口能否作为「不经过本机网关的调用用量」的数据源 ——
//! 也就是它一次返回的全部字段里，有没有**逐请求/逐日用量**，而不只是「当前剩余额度」。
//!
//! 结论直接决定要不要为 Trae 建一个 `official_usage` 投影模块。
//!
//! ## 只读、只查询
//!
//! 只发 POST 查询，不签到、不改任何本地状态。输出**绝不打印 JWT**，
//! 只打印状态码、顶层键、以及结构骨架。
//!
//! 默认 `#[ignore]`，不会在 CI / `cargo test --workspace` 里跑（依赖真实凭据与网络）。
//!
//! ```bash
//! # 用本机切换器账号库里的第一个账号
//! cargo test -p buddy-switch-core --test trae_usage_live_probe -- --ignored --nocapture
//!
//! # 或显式指定 JWT（不落盘、不进日志）
//! TRAE_PROBE_JWT='<jwt>' cargo test -p buddy-switch-core \
//!     --test trae_usage_live_probe -- --ignored --nocapture
//! ```

use std::collections::BTreeMap;

use buddy_switch_core::modules::trae::credits;
use buddy_switch_core::modules::trae::device::DeviceEntry;
use buddy_switch_core::modules::trae::endpoints_for;
use buddy_switch_core::modules::trae::variant::TraeVariant;
use buddy_switch_core::modules::trae::TRAE_ENTITLEMENT_PATH;
use serde_json::Value;

/// 当前实现发的请求体。
const CURRENT_BODY: &str = "{}";

/// 真实客户端 SDK 默认发的请求体。
const CLIENT_BODY: &str = r#"{"require_usage":true,"full_data":true}"#;

/// 客户端另一个真实调用点用的路径（`user_current_entitlement_list`）。
/// 先探测它是否存在，作为备选数据源。
const ENTITLEMENT_LIST_PATH: &str = "/trae/api/v2/pay/user_current_entitlement_list";

/// 取一个可用的 JWT：优先环境变量，其次本机切换器 Trae 账号库的第一个账号。
fn probe_jwt() -> Option<String> {
    if let Ok(value) = std::env::var("TRAE_PROBE_JWT") {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Some(value);
        }
    }
    buddy_switch_core::modules::trae::account::entries()
        .into_iter()
        .map(|(_, account)| account.jwt)
        .find(|jwt| !jwt.trim().is_empty())
}

/// 按 `credits::post_json` 的方式发一次请求，但允许自定义路径与请求体。
async fn post_path_body(
    path: &str,
    body: &str,
    jwt: &str,
    device: &DeviceEntry,
) -> (u16, String) {
    let url = format!(
        "{}{path}",
        endpoints_for(TraeVariant::default()).account_base
    );
    let mut request = credits::trae_http_client().post(&url).body(body.to_string());
    for (key, value) in credits::build_headers(jwt, device) {
        request = request.header(key, value);
    }
    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            (status, text)
        }
        Err(error) => (0, format!("{error}")),
    }
}

/// 递归打印 JSON 结构骨架（键名 + 类型 + 数组长度），**不打印字符串字面量值**，
/// 避免把 uid / token / 邮箱等敏感内容带出来。只对数字与布尔显示取值。
fn dump_skeleton(value: &Value, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    match value {
        Value::Object(map) => {
            // 键名排序，输出稳定可比对。
            let sorted: BTreeMap<&String, &Value> = map.iter().collect();
            for (key, item) in sorted {
                match item {
                    Value::Object(_) => {
                        out.push_str(&format!("{pad}{key}: {{}}\n"));
                        dump_skeleton(item, indent + 1, out);
                    }
                    Value::Array(items) => {
                        out.push_str(&format!("{pad}{key}: [ {} 项 ]\n", items.len()));
                        if let Some(first) = items.first() {
                            out.push_str(&format!("{pad}  └─ 首元素:\n"));
                            dump_skeleton(first, indent + 2, out);
                        }
                    }
                    Value::String(_) => out.push_str(&format!("{pad}{key}: <string>\n")),
                    other => out.push_str(&format!("{pad}{key}: {other}\n")),
                }
            }
        }
        Value::Array(items) => {
            out.push_str(&format!("{pad}[array {} 项]\n", items.len()));
        }
        Value::String(_) => out.push_str(&format!("{pad}<string>\n")),
        other => out.push_str(&format!("{pad}{other}\n")),
    }
}

/// 找出响应里所有「看起来含逐条用量」的键路径，用于判断能否支撑「官方用量」视图。
fn find_usage_like_keys(value: &Value) -> Vec<String> {
    let needles = [
        "usage", "amount", "count", "request", "record", "detail", "list", "daily", "log",
        "credits_amount", "tokens", "total",
    ];
    let mut hits = Vec::new();
    fn walk(value: &Value, path: &str, needles: &[&str], hits: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, item) in map {
                    let lower = key.to_ascii_lowercase();
                    let child = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };
                    if needles.iter().any(|needle| lower.contains(needle)) {
                        let shape = match item {
                            Value::Array(items) => format!("[{}]", items.len()),
                            Value::Object(_) => "{}".to_string(),
                            Value::String(_) => "<string>".to_string(),
                            other => other.to_string(),
                        };
                        hits.push(format!("{child} = {shape}"));
                    }
                    walk(item, &child, needles, hits);
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, path, needles, hits);
                }
            }
            _ => {}
        }
    }
    walk(value, "", &needles, &mut hits);
    hits
}

/// 概括一次响应：状态码、顶层键、是否含 pack_list、结构骨架。
fn report(label: &str, status: u16, body: &str) {
    println!("\n========== {label} ==========");
    println!("状态码: {status}");
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let Some(value) = parsed else {
        println!("非 JSON 响应（截断 240 字符）:");
        println!("{}", body.chars().take(240).collect::<String>());
        return;
    };
    let mut skeleton = String::new();
    dump_skeleton(&value, 0, &mut skeleton);
    println!("结构骨架:\n{skeleton}");

    let has_pack_list = value
        .get("user_entitlement_pack_list")
        .and_then(Value::as_array)
        .map(|items| items.len());
    println!("user_entitlement_pack_list: {has_pack_list:?}");

    let hits = find_usage_like_keys(&value);
    if hits.is_empty() {
        println!("未发现「逐条用量」形态的键");
    } else {
        println!("疑似用量相关键（{} 条）:", hits.len());
        for hit in hits.iter().take(40) {
            println!("  - {hit}");
        }
    }
}

#[tokio::test]
#[ignore = "需要真实 Trae 凭据与网络；用 --ignored 手动运行"]
async fn probe_trae_official_usage_shape() {
    let Some(jwt) = probe_jwt() else {
        eprintln!(
            "跳过：没有可用凭据。请先用切换器登录一个 Trae 账号，\
             或设置 TRAE_PROBE_JWT 环境变量。"
        );
        return;
    };
    let device = credits::device_for_jwt(&jwt).expect("JWT 应能解析出 user id 并派生出设备");
    println!(
        "账号 {}（JWT 长度 {}，不回显内容）",
        device.device_id.chars().take(6).collect::<String>() + "…",
        jwt.len()
    );
    println!(
        "端点基址: {}",
        endpoints_for(TraeVariant::default()).account_base
    );

    // ① 现实现：body = {}
    let (s1, b1) = post_path_body(TRAE_ENTITLEMENT_PATH, CURRENT_BODY, &jwt, &device).await;
    report(
        &format!("① 现实现 {TRAE_ENTITLEMENT_PATH}  body = {CURRENT_BODY}"),
        s1,
        &b1,
    );

    // ② 客户端 SDK：body = {require_usage,full_data}
    let (s2, b2) = post_path_body(TRAE_ENTITLEMENT_PATH, CLIENT_BODY, &jwt, &device).await;
    report(
        &format!("② 客户端 SDK {TRAE_ENTITLEMENT_PATH}  body = {CLIENT_BODY}"),
        s2,
        &b2,
    );

    // ③ 备选路径：user_current_entitlement_list
    let (s3, b3) = post_path_body(ENTITLEMENT_LIST_PATH, CLIENT_BODY, &jwt, &device).await;
    report(
        &format!("③ 备选路径 {ENTITLEMENT_LIST_PATH}  body = {CLIENT_BODY}"),
        s3,
        &b3,
    );

    // ④ 结论提示
    println!("\n========== 结论提示 ==========");
    println!("对照 ①②：若 ② 的 pack_list 更完整 → `post_json` 的 body 应改为 CLIENT_BODY。");
    println!("对照 ②③：若 ③ 返回了逐条/逐日用量 → Trae「官方用量」应改用该路径。");
    println!("若三次都只有「剩余额度」而无逐条明细 → 该接口无法支撑用量视图，需另寻数据源。");
}
