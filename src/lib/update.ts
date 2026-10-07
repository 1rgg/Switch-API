/**
 * 本分支（二次开发）的发布坐标。
 *
 * ⚠️ 必须与 Rust 侧 `buddy_switch_core::modules::update::{GITHUB_OWNER, GITHUB_REPO}`
 * 以及 `src-tauri/tauri.conf.json > plugins.updater.endpoints` 三处保持一致。
 *
 * 这三处指向不同的仓库会出具体故障，而不是"看起来不统一"这么轻：
 *   - 只改 Rust、漏改这里 → 设置页「仓库」显示与「打开 Release 页」跳到上游，
 *     而实际更新走本分支；用户手动去上游下包，装上的包签名不匹配、装不上。
 *   - 只改这里、漏改 Rust → 检查更新查上游、下载上游包、验签失败。
 *
 * 上游 `NextAgentX/trae-workbuddy-switch` 是**二次开发的来源**，不是发布目标，
 * 因此不再出现在这些常量里（README / LICENSE 里的上游署名仍应保留）。
 */
export const GITHUB_OWNER = "1rgg";
export const GITHUB_REPO = "Switch-API";
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_RELEASE_URL = `${GITHUB_REPOSITORY_URL}/releases/latest`;

/** 在桌面端通过 Tauri opener 打开，在 webui 端打开新标签页。 */
export async function openReleaseUrl(url = GITHUB_RELEASE_URL): Promise<void> {
  const isWebui = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);
  if (isWebui) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
