#!/bin/bash
# 统一 bump 版本：usage: sh scripts/bump-version.sh 0.1.5
#
# 用 node 而不是 perl 做替换：本项目本就强依赖 node（Tauri + vite），
# 而 perl 在 Windows / Git Bash 上默认不存在——原实现会在这里直接失败。
#
# ⚠️ 日期形态的版本（如 `2026.10.07`）在 Cargo 侧会自动去掉前导零
# （严格 semver 不接受 `07`）。JSON / tauri.conf 仍保留原字符串，
# 因此安装包名与 Release tag 就是你要的那个。详见脚本内 `semver` 的注释。
set -e
V=$1
[ -z "$V" ] && echo "用法: sh scripts/bump-version.sh <新版本>" && exit 1
cd "$(dirname "$0")/.."

node - "$V" <<'EOF'
const fs = require('fs');
const path = require('path');
const version = process.argv[2];

/**
 * Cargo 用的版本号：与用户输入的 `version` **可能不同**。
 *
 * Cargo 走严格 semver，**禁止**数字段带前导零：
 *     version = "2026.10.07"   →  error: invalid leading zero in patch version number
 * 而日期形态的版本（如用户指定的 `2026.10.07`）天然带前导零，
 * 于是「JSON 侧合法、Cargo 侧直接构建失败」—— 失败点在 CI 的
 * `cargo metadata`，本地无 Rust 工具链时**完全看不出来**。
 *
 * 处理：JSON / tauri.conf 保留原样（那是安装包名、Release tag、更新清单
 * 的取值来源，必须是用户要的那个字符串）；Cargo 侧去掉前导零。
 *
 * 两者不等会不会让自动更新误判？不会：`update::compare_versions` 按
 * `split('.').parse::<i64>()` 比较，`07` 与 `7` 都解析成 `7`，
 * 因此 `2026.10.07` 与 `2026.10.7` 判等（见 update.rs 的
 * `compare_versions_orders_build_stamped_versions`）。
 */
const semver = version
  .split('.')
  .map((seg) => (/^\d+$/.test(seg) ? String(Number(seg)) : seg))
  .join('.');
if (semver !== version) {
  console.log(`注意：Cargo 用 "${semver}"（去前导零；严格 semver 不接受 "${version}"）`);
}

/** 只替换 JSON 顶层 version 字段，避免误伤 dependencies 里的同名键。 */
function bumpJsonVersion(file) {
  if (!fs.existsSync(file)) {
    console.warn(`跳过（不存在）: ${file}`);
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(raw);
  if (json.version === undefined) {
    console.warn(`跳过（无 version 字段）: ${file}`);
    return;
  }
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`已更新: ${file}`);
}

/** 只替换 Cargo.toml 中 [package] 段下的 version（首个 ^version = "..." 行）。 */
function bumpCargoVersion(file) {
  if (!fs.existsSync(file)) {
    console.warn(`跳过（不存在）: ${file}`);
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const next = raw.replace(/^version = "[^"]+"/m, `version = "${semver}"`);
  if (next === raw) {
    console.warn(`跳过（未匹配 version 行）: ${file}`);
    return;
  }
  fs.writeFileSync(file, next);
  console.log(`已更新: ${file}  → ${semver}`);
}

const jsonTargets = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'npm/package.json',
];
for (const file of jsonTargets) bumpJsonVersion(file);

// 平台包的 version 与主包 optionalDependencies 的引用必须同步，
// 否则 npm 安装时会去拉一个不存在的版本。
for (const dir of fs.readdirSync('npm/platform')) {
  const file = path.join('npm/platform', dir, 'package.json');
  bumpJsonVersion(file);
}

const mainPkgPath = 'npm/package.json';
const mainPkg = JSON.parse(fs.readFileSync(mainPkgPath, 'utf8'));
for (const key of Object.keys(mainPkg.optionalDependencies || {})) {
  mainPkg.optionalDependencies[key] = version;
}
fs.writeFileSync(mainPkgPath, JSON.stringify(mainPkg, null, 2) + '\n');

// 四个 crate 都要同步：漏掉任何一个，`env!("CARGO_PKG_VERSION")` 就会
// 在「API 服务」页显示成旧版本号（该值会被透出到网关 /status）。
const cargoTargets = [
  'src-tauri/Cargo.toml',
  'crates/buddy-switch-core/Cargo.toml',
  'crates/buddy-switch-server/Cargo.toml',
  'crates/buddy-switch-gateway/Cargo.toml',
];
for (const file of cargoTargets) bumpCargoVersion(file);

/**
 * Cargo.lock 里也记着四个工作区成员的版本。
 *
 * 不同步会让 `cargo build --locked` 直接失败（「the lock file needs to be updated」），
 * 而 CI 若用 `--locked` 就卡在这里；即使不用 `--locked`，Cargo 也会**就地改写**
 * Cargo.lock，于是每次构建都留下一个未提交的改动，下一轮 checkout 又要重来。
 * 替换只针对「工作区成员那四行」的旧版本值，不会碰到依赖的正常版本。
 */
if (fs.existsSync('Cargo.lock')) {
  const lock = fs.readFileSync('Cargo.lock', 'utf8');
  // 只替换**已知的历史版本值**，避免误伤依赖（依赖版本形态是 `1.0.123`，
  // 与本项目 `2026.x.y` 的形态不重叠，所以按 `2026.` 前缀限定的替换是安全的）。
  const next = lock.replace(/^(version = ")2026\.[^"]*(")$/gm, `$1${semver}$2`);
  if (next !== lock) {
    fs.writeFileSync('Cargo.lock', next);
    console.log(`已更新: Cargo.lock  → ${semver}`);
  } else {
    console.log('跳过（Cargo.lock 无需更新）: Cargo.lock');
  }
} else {
  console.warn('跳过（不存在）: Cargo.lock');
}

console.log(
  `版本已同步：JSON / tauri.conf = ${version}` +
    (semver === version ? '' : `，Cargo = ${semver}`) +
    `（含 npm 主包与平台包、optionalDependencies、4 个 crate 与 Cargo.lock）`,
);
EOF
