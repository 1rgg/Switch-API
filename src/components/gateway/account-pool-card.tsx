import { Users } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { POOL_STATUS_LABELS } from "@/lib/gateway";
import { useT } from "@/lib/i18n";
import type { GatewayPoolAccount, GatewayPoolSummary } from "@/lib/types";
import type { TranslationKey } from "@/locales/zh";
import { cn } from "@/lib/utils";

/**
 * 「不指定」的哨兵值。
 *
 * Radix `Select` 不接受空字符串作为 `SelectItem` 的 value，而后端契约里
 * **空串才表示「不指定」**，因此 UI 层用一个不可能与 uid 冲突的哨兵值承载它，
 * 在边界处转换。
 */
export const AUTO_OPTION = "__auto__";

/** 五态计数格。 */
export type PoolTileKey = "available" | "cooling" | "disabled" | "expired" | "zeroCredits";

/** 默认五格（Trae 侧：积分过期有判据）。 */
export const DEFAULT_POOL_TILES: PoolTileKey[] = [
  "available",
  "cooling",
  "disabled",
  "expired",
  "zeroCredits",
];

/**
 * WorkBuddy 侧的四格 —— **没有「积分过期」**。
 *
 * 后端池条目只存「快过期的积分**数量**」，不存有效期，没有判据 ⇒ 该 state 恒为 0。
 * 与其摆一个永远为 0 的假格子，不如不给（诚实 > 看起来对齐）。
 */
export const WB_POOL_TILES: PoolTileKey[] = ["available", "cooling", "disabled", "zeroCredits"];

const TILE_META: Record<PoolTileKey, { labelKey: TranslationKey; tone: "ok" | "warn" | "danger" | "muted" }> = {
  available: { labelKey: "shared.gateway.pool.tile.available", tone: "ok" },
  cooling: { labelKey: "shared.gateway.pool.tile.cooling", tone: "warn" },
  disabled: { labelKey: "shared.gateway.pool.tile.disabled", tone: "danger" },
  expired: { labelKey: "shared.gateway.pool.tile.expired", tone: "warn" },
  zeroCredits: { labelKey: "shared.gateway.pool.tile.zeroCredits", tone: "muted" },
};

function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 账号池卡 —— **WorkBuddy 与 Trae 共用同一张**（用户诉求：两边 API 页同一套交互）。
 *
 * 数据全部由调用方传入（状态来自各自的 `*_gateway_status`），卡片自身不发请求，
 * 因此两侧的差异只剩两处**数据驱动**的参数：
 * - [`tiles`]：计数格。Trae 五格，WorkBuddy 四格（无积分过期判据）。
 * - [`autoOptions`]：下拉里除账号之外的选项。Trae 只有「不指定」；WorkBuddy 另有
 *   「按实时积分择优」（那是它自己的策略能力，写回 `AccountStrategy`）。
 *
 * ## 指定账号的语义（务必与后端一致）
 *
 * 它是**偏好而非约束**：指定账号不可用（冷却 / 禁用 / 零积分 / 已在本轮试过）时，
 * 网关会**回落到自动择优**，不会因为指定账号不可用而拒绝服务。
 * 因此这里不把「当前不可用」的账号禁用掉 —— 用户仍然可以指定它，等它恢复后自动生效。
 */
export function AccountPoolCard({
  pool,
  accounts,
  diagnose,
  preferredUid,
  onPreferredUidChange,
  saving = false,
  totalRequests = null,
  tiles = DEFAULT_POOL_TILES,
  autoOptions,
  emptyHint,
  /** 卡片标题（WorkBuddy 一页有两张卡 ⇒ 带版本名；缺省用共用文案）。 */
  title,
  className,
}: {
  pool: GatewayPoolSummary | null;
  accounts: GatewayPoolAccount[];
  /** 逐账号「为什么不能路由」的可读串。 */
  diagnose: string[];
  /** 当前指定的账号 uid；空串表示不指定。 */
  preferredUid: string;
  /** 选择变化时回调（空串 = 不指定）。 */
  onPreferredUidChange: (uid: string) => void;
  /** 保存中：禁用选择器，避免连点产生两次写入。 */
  saving?: boolean;
  /** 累计请求数（WorkBuddy 侧无该数据 ⇒ 不传）。 */
  totalRequests?: number | null;
  /** 计数格（默认五格；WorkBuddy 传 [`WB_POOL_TILES`]）。 */
  tiles?: PoolTileKey[];
  /** 下拉里「非账号」的选项（缺省只有「不指定」）。 */
  autoOptions?: { value: string; label: string }[];
  /** 空态文案（缺省用共用文案）。 */
  emptyHint?: ReactNode;
  /** 卡片标题（缺省「账号池」）。 */
  title?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const options = autoOptions ?? [
    { value: AUTO_OPTION, label: t("shared.gateway.pool.preferredAuto") },
  ];
  const preferredInPool = preferredUid !== "" && accounts.some((a) => a.uid === preferredUid);
  // 「不指定」的取值是空串，但 Radix 不吃空串 value ⇒ 用哨兵值显示。
  const selectValue = preferredUid === "" ? AUTO_OPTION : preferredUid;

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 stroke-[1.75]" />
          {title ?? t("shared.gateway.pool.title")}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("shared.gateway.pool.preferredLabel")}
            </span>
            <Select
              value={selectValue}
              onValueChange={(next) => onPreferredUidChange(next === AUTO_OPTION ? "" : next)}
              disabled={saving}
            >
              <SelectTrigger
                size="sm"
                className="w-48"
                aria-label={t("shared.gateway.pool.preferredAria")}
              >
                <SelectValue placeholder={t("shared.gateway.pool.preferredAuto")} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
                {accounts.map((account) => (
                  <SelectItem key={account.uid} value={account.uid}>
                    {account.name}
                  </SelectItem>
                ))}
                {/* 指定的账号已不在池中（被删除 / 换了产品线）：仍要显示出来，
                    否则 Select 找不到匹配项会显示成空白，用户以为「没指定」。 */}
                {preferredUid !== "" && !preferredInPool && (
                  <SelectItem value={preferredUid}>
                    {t("shared.gateway.pool.preferredMissing")}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          {totalRequests !== null && (
            <span className="text-xs text-muted-foreground">
              {t("shared.gateway.pool.totalRequests", { count: formatCount(totalRequests) })}
            </span>
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid gap-0 border-b border-border/60",
          tiles.length === 5 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {tiles.map((key, index) => {
          const meta = TILE_META[key];
          return (
            <div
              key={key}
              className={cn(
                "flex flex-col items-center justify-center px-3 py-4 text-center",
                index > 0 && "border-l border-border/60",
              )}
            >
              <span className="text-xs text-muted-foreground">{t(meta.labelKey)}</span>
              <span
                className={cn(
                  "mt-2 text-2xl font-semibold tabular-nums tracking-[-0.02em]",
                  meta.tone === "ok"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : meta.tone === "warn"
                      ? "text-amber-600 dark:text-amber-400"
                      : meta.tone === "danger"
                        ? "text-destructive"
                        : "text-muted-foreground",
                )}
              >
                {pool?.[key] ?? 0}
              </span>
            </div>
          );
        })}
      </div>

      {accounts.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">
          {emptyHint ?? t("shared.gateway.pool.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {accounts.map((account) => {
            const meta = POOL_STATUS_LABELS[account.status];
            return (
              <div key={account.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{account.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("shared.gateway.pool.credits", {
                    credits: formatCredits(account.credits),
                  })}
                </span>
                <Badge
                  variant={meta.tone === "danger" ? "destructive" : "secondary"}
                  className={cn(
                    "shrink-0",
                    meta.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
                    meta.tone === "warn" && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {meta.label}
                </Badge>
                {account.cooldownReason && (
                  <span className="w-full truncate text-xs text-muted-foreground sm:w-auto">
                    {account.cooldownReason}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border/60 px-5 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {t("shared.gateway.pool.preferredHint")}
        </p>
      </div>

      {diagnose.length > 0 && (
        <div className="border-t border-border/60 px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t("shared.gateway.pool.diagnoseNote")}
          </p>
          <ul className="mt-2 space-y-1">
            {diagnose.map((line) => (
              <li key={line} className="break-all font-mono text-xs text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
