import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { CreditSortDirection } from "@/lib/credit-sort";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/locales/zh";

/**
 * 「积分倍率」列头 —— 可点击，三态循环（无 → 升 → 降 → 无）。
 *
 * ## 为什么抽成共享组件
 *
 * WorkBuddy 与 Trae 两张模型表刻意**逐列对齐**（同样的六列表头、同样的列宽层级）。
 * 排序控件若是两份手写实现，图标 / 无障碍属性 / 循环顺序迟早会有一侧漂移，
 * 而用户看到的是**同一页**上的两张表 —— 不一致会立刻被察觉。
 * 因此表头渲染与 `credit-sort.ts` 的状态机一样，都只留一份。
 *
 * ## 为什么文案键由调用方传入
 *
 * 两个产品各有一套 locale 命名空间（`wbStats.gateway.*` / `trae.gateway.models.*`），
 * 键名不同但**语义必须一致**。这里不把键写死，而是让调用方把五个键传进来 ——
 * 既保留两套独立词表，又强迫两侧显式提供全套（漏传一个就是 TS 报错，
 * 不会退化成「Trae 侧悄悄用了 WorkBuddy 的文案」）。
 *
 * ## 图标语义
 *
 * - 无排序：`ArrowUpDown`（双向箭头，灰）—— 表头本身是按钮，暗示可点；
 * - 升序：`ArrowUp`（向上 = 从小到大的方向感）；
 * - 降序：`ArrowDown`。
 *
 * ## 无障碍
 *
 * 用真 `<button>` 而非 `<th onClick>`：键盘可 Tab 到、Enter/Space 可触发。
 * `aria-sort` 按 WAI-ARIA 规范只允许 `ascending` / `descending` / `none`
 * 三个字面量，**不能**塞业务词，故这里显式映射。
 * `title` 给出「点下去会发生什么」，而不是「当前是什么状态」—— 前者更有用。
 */
export interface CreditSortHeaderLabels {
  /** 列名本身，如「积分倍率」。 */
  column: TranslationKey;
  /** 可访问名：这一列能排序。 */
  sortLabel: TranslationKey;
  /** 点下去会变成「从低到高」。 */
  toAsc: TranslationKey;
  /** 点下去会变成「从高到低」。 */
  toDesc: TranslationKey;
  /** 点下去会恢复原序。 */
  toNone: TranslationKey;
  /** 长提示：无倍率的模型为什么排最后。 */
  tip: TranslationKey;
}

export function CreditSortHeader({
  direction,
  onToggle,
  labels,
  className,
}: {
  direction: CreditSortDirection;
  onToggle: () => void;
  labels: CreditSortHeaderLabels;
  className?: string;
}) {
  const t = useT();

  /** 「点下去会变成什么」—— 比「现在是什么」更有信息量。 */
  const nextLabel =
    direction === null ? t(labels.toAsc) : direction === "asc" ? t(labels.toDesc) : t(labels.toNone);

  return (
    <th
      className={cn("py-2 pr-4 font-medium", className)}
      // WAI-ARIA 只认这三个字面量；业务三态在组件内部映射，不泄漏到属性上。
      aria-sort={direction === null ? "none" : direction === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        onClick={onToggle}
        // 验收钩子：CDP 场景据此定位并断言当前排序态，不必靠图标 / className 反查
        // —— 那两者都会随样式漂移。
        data-credit-sort={direction ?? "none"}
        title={t(labels.tip)}
        aria-label={`${t(labels.sortLabel)}：${nextLabel}`}
        className={cn(
          "inline-flex items-center gap-1 rounded text-xs outline-none transition-colors",
          "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          direction === null ? "text-muted-foreground" : "font-medium text-foreground",
        )}
      >
        {t(labels.column)}
        {direction === null ? (
          <ArrowUpDown className="size-3 opacity-60" />
        ) : direction === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )}
      </button>
    </th>
  );
}
