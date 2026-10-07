import type { ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * 状态圆点的三档，语义**中性**（同一套视觉、各页各自解释含义）：
 *
 * - `active`：主色实心 —— 该版本**此刻可用**（Trae 侧 = 客户端在运行；账号页 = 已登录）。
 * - `idle`：灰色实心 —— 存在但未激活（装了没跑 / 装了没登录）。
 * - `absent`：空心圈 —— 该版本在这台机器上不存在。
 *
 * ⚠️ 只有 Trae 侧用得上：它的区域对应**不同的客户端进程**，「装了没 / 跑了没」是真实信息。
 * WorkBuddy 的两个版本是同一客户端下的两种**数据域**，恒存在 ⇒ 不传该字段
 * （不传就不渲染圆点，而不是渲染一个永远同色的假圆点）。
 */
export type VariantPresence = "active" | "idle" | "absent";

export interface VariantSwitchItem {
  /** 版本 / 区域标识（`cn` / `global` / `all`…）。 */
  value: string;
  /** 主行文字。 */
  label: string;
  /** 状态圆点；不传则不渲染。 */
  presence?: VariantPresence;
  /** 版本图标（Trae 侧用；WorkBuddy 无对应概念）。 */
  mark?: ReactNode;
  /**
   * 第二行详情（账号页用：`已登录: 张三` / `未登录` / `未检测到`）。
   *
   * **不传即单行紧凑**——标题下方是页面级入口，不该抢主内容；
   * 只有账号页需要「各版本登录态」这层信息，才升成两行。
   */
  detail?: string;
  /** 悬停提示（Trae 侧放「运行状态 + 客户端版本号」）。 */
  title?: string;
}

const PRESENCE_DOT: Record<VariantPresence, string> = {
  active: "bg-primary",
  idle: "bg-muted-foreground/40",
  absent: "border border-muted-foreground/50",
};

/**
 * **两个模块共用**的版本 / 区域切换器（2026-09-30 统一）。
 *
 * ## 为什么要有这个共用组件
 *
 * 改造前两侧各写各的、且**同一模块内也不一致**：Trae 的 4 个页面用按钮组
 * （`TraeVariantSwitch`），账号页用两行富状态条（`TraeVariantBar`）；
 * WorkBuddy 的 API 页用纯文字 Tabs，账号页用另一套两行 Tabs，统计页又是 `RegionBar`。
 * 位置也分成「页头右侧」与「标题下方」两派。
 *
 * 现在：**位置统一在标题下方（左对齐）**，视觉统一到本组件，
 * 差异只剩「是否显示状态圆点 / 图标」（有无该信息）与「单行 / 两行」（信息密度）。
 *
 * ## 刻意不用 `TabsContent`
 *
 * 切换只改 URL / 状态，由各页面自己的取数逻辑重取数据。
 * 若为每个版本各挂一个 `<TabsContent>`，每次切换都会重复挂载一次取数（Trae 侧踩过）。
 */
export function VariantSwitch({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: VariantSwitchItem[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className={cn("min-w-0", className)}>
      <TabsList className="h-auto max-w-full flex-wrap gap-1 p-1" aria-label={ariaLabel}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            title={item.title}
            className={cn(
              "h-auto max-w-full",
              item.detail
                ? "flex-col items-start gap-0.5 rounded-lg px-4 py-2 text-left"
                : "gap-1.5 rounded-lg px-3 py-1.5",
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              {item.presence && (
                <span
                  className={cn("inline-block size-2 shrink-0 rounded-full", PRESENCE_DOT[item.presence])}
                  aria-hidden="true"
                />
              )}
              {item.mark}
              {item.label}
            </span>
            {item.detail && (
              <span className="pl-3.5 text-[11px] font-normal text-muted-foreground">{item.detail}</span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
