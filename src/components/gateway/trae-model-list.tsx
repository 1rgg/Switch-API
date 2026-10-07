import { useState } from "react";
import { Cpu, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DemoAction } from "@/components/demo-action";
import { TraeVariantMark } from "@/components/product-marks";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TraeClientModel, TraeModelSource, TraeVariantId } from "@/lib/trae-types";

/**
 * Trae 模型清单 —— 读**客户端（上游下发）**的清单缓存。
 *
 * ## 为什么现在**有**刷新按钮（推翻了上一版的裁定）
 *
 * 上一版这里是静态常量（`buddy-switch-gateway` 的 `payload::MODEL_NAMES`），
 * 「刷新」永远不可能改变结果，因此当时判定为假控件、刻意不加按钮，只留一行说明。
 *
 * issue #4 之后数据源换成了**客户端 `state.vscdb` 里的上游清单缓存**
 * （见 core 的 `trae::model_list`）：客户端刷新过模型列表之后，这里重新读一次
 * **真的**会拿到新清单。按钮不再是假控件，因此恢复。
 *
 * ## 为什么卡上要有一个**程序位**选择器（issue #4 的后续报障）
 *
 * 清单是**客户端级**的，而一个区域下有两条程序位（TraeWork / TraeCode），
 * 两个客户端的上游清单**完全不同**（function 分组、模型集合都不一样）。
 * 上一版这里只读区域主程序（TraeWork）那一份，于是 TraeCode 专有的模型
 * （实测 `glm-5.3-flash`）**在界面上永远看不到** —— 用户报的就是这一条。
 *
 * 因此选择器是**取数据的一部分**，不是装饰：切到哪条程序位就读哪份缓存
 * （数据由宿主页按 `sources` 一次性取好，切换不发请求、不闪骨架）。
 *
 * ## 网关对外清单**按 API Key 的归属程序位**取（2026-09-30 起）
 *
 * `/v1/models` 与请求体的 `function` 都由 Key 的程序位决定，**两条程序位的清单不同**
 * （TraeWork → `solo_work_lite`，TraeCode → `chat_v3`；上游按 function 做白名单，
 * 2026-09-30 实测）。因此卡上展示的「网关对外 N 个」是**当前选中程序位**那一份 ——
 * 也就是「拿这个程序位的 Key 连本网关，外部客户端会看到什么」。
 *
 * ⇒ 要给某个程序位建 Key，去上面的「API Key」卡把归属选成对应程序位。
 *
 * ## 空态不是错误
 *
 * 客户端没启动过 / 没登录 / 还没拉过清单时，后端返回 `source = "missing"` 与
 * 一句可读的 `note`。这里按空态呈现，**不报错** —— 「少一张清单」远好过整页红。
 */
export function TraeModelList({
  sources,
  defaultModel,
  refreshing,
  onRefresh,
  className,
}: {
  /**
   * 本区域**各程序位**的客户端清单（顺序 = 主程序在前）。
   *
   * 宿主页在**同一次**快照里把各程序位都取好（本地 SQLite 读，成本可忽略），
   * 因此切换程序位是纯前端行为，不需要新命令、也不会出现两份互不一致的快照。
   */
  sources: TraeModelSource[];
  /** 网关配置里的默认模型（仅用于摘要文案）。 */
  defaultModel: string;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const t = useT();

  /**
   * 用户手动选中的程序位。
   *
   * **不落 URL、不落 store**：它是本卡片的取数参数，属于「操作处的 L3 参数」
   * （与 IA 提案里 `Trae 程序位` 那一行的载体一致），不是页面级状态。
   *
   * 选中值不在 `sources` 里时（例如切了区域）自动回落 `sources[0]`（区域主程序），
   * 因此**不需要** effect 去同步/清理 —— 少一处会在切换瞬间闪一下的中间态。
   */
  const [picked, setPicked] = useState<TraeVariantId | null>(null);
  const active = sources.find((source) => source.variant === picked) ?? sources[0] ?? null;
  const data = active?.data ?? null;
  /** 当前程序位的**网关对外清单** id 集合（见 `TraeModelSource.gatewayNames`）。 */
  const servableNames = active?.gatewayNames ? new Set(active.gatewayNames) : null;
  const gatewayCount = active?.gatewayNames?.length ?? null;

  const groups = data?.groups ?? [];
  /**
   * 摘要用**去重后**的数量。
   *
   * 同一模型会在多个 function 分组里重复出现（实测 `solo_work_lite` 与
   * `solo_work_remote` 内容完全相同），直接累加会得到「共 99 个」这种与
   * 「网关对外 27 个」对不上的数字 —— 用户会以为哪里算错了。
   */
  const total = new Set(groups.flatMap((group) => group.models.map((model) => model.name))).size;
  const loaded = data?.source === "client-cache" && total > 0;

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="size-4 stroke-[1.75]" />
          {t("trae.gateway.models.title")}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {sources.length > 1 && (
            <div
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1"
              role="tablist"
              aria-label={t("trae.gateway.models.program")}
            >
              {sources.map((source) => {
                const selected = source.variant === active?.variant;
                return (
                  <button
                    key={source.variant}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setPicked(source.variant)}
                    title={t("trae.gateway.models.programTip", { label: source.label })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring/50",
                      selected
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <TraeVariantMark variant={source.variant} size={15} />
                    <span>{source.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {t("trae.gateway.models.summary", { count: total, model: defaultModel })}
          </span>
          <DemoAction>
            <Button variant="ghost" size="sm" onClick={() => onRefresh()} disabled={refreshing}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("trae.gateway.models.refresh")}
            </Button>
          </DemoAction>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="mb-3 text-xs text-muted-foreground">{t("trae.gateway.models.note")}</p>

        {(data !== null || gatewayCount !== null) && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {data && (
              <span className="flex items-center gap-1.5">
                {t("trae.gateway.models.source")}
                <Badge variant={loaded ? "success" : "warning"} className="rounded-md">
                  {t(
                    loaded ? "trae.gateway.models.sourceCache" : "trae.gateway.models.sourceMissing",
                  )}
                </Badge>
              </span>
            )}
            {data && loaded && (
              <span>{t("trae.gateway.models.readAt", { time: formatTime(data.readAt) })}</span>
            )}
            {/* 读的是**哪个客户端**的缓存：同机两条程序位各有一份，必须写出来，
                否则用户看到数字对不上时无从判断「这是哪条线的清单」。 */}
            {active && (
              <span title={data?.dataDir ?? undefined}>
                {t("trae.gateway.models.readFrom", { label: active.label })}
              </span>
            )}
            {gatewayCount !== null && (
              <span>
                {active
                  ? t("trae.gateway.models.gatewayCountFor", {
                      count: gatewayCount,
                      program: active.label,
                    })
                  : t("trae.gateway.models.gatewayCount", { count: gatewayCount })}
              </span>
            )}
          </div>
        )}

        {data?.note && <p className="mb-3 text-xs text-amber-600">{data.note}</p>}

        {!loaded ? (
          <p className="py-4 text-sm text-muted-foreground">{t("trae.gateway.models.empty")}</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.function} className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs text-muted-foreground">{group.function}</code>
                  <span className="text-xs text-muted-foreground">
                    {t("trae.gateway.models.groupCount", { count: group.models.length })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.models.map((model) => (
                    <ModelChip
                      key={model.name}
                      model={model}
                      servable={servableNames ? servableNames.has(model.name) : null}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * 单个模型条目：展示名为主，模型名（调用时真正要传的）用等宽小字跟随。
 *
 * `servable` = 该模型在**网关对外清单**里吗（`null` = 没取到对外清单，不标注）。
 * 客户端清单是**全部分组**的并集，而网关只用本程序位那一个 `function` 发请求
 * —— 不属于该分组的模型一律 `4001`。打上「网关不提供」标记，
 * 就把「看得见、调不动」在**逐个模型**这一层堵死（issue #4 的原始报障）。
 */
function ModelChip({ model, servable }: { model: TraeClientModel; servable: boolean | null }) {
  const t = useT();
  const context = model.contextWindow
    ? t("trae.gateway.models.context", { tokens: formatTokens(model.contextWindow) })
    : "";

  return (
    <span
      // 验收钩子：CDP 场景据此逐个断言「这个模型网关到底提不提供」，
      // 不必靠 className / 文案反查（那两者都会随样式漂移）。
      data-model={model.name}
      data-served={servable === null ? "unknown" : servable ? "yes" : "no"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
        model.isDefault ? "border-foreground/30 bg-foreground/[0.06]" : "border-border bg-muted/40",
        // 网关调不到的模型压暗：仍可看到（它确实在客户端里），但一眼知道不能调。
        servable === false && "border-dashed opacity-60",
      )}
      title={context ? `${model.name} · ${context}` : model.name}
    >
      <span className="font-medium">{model.displayName}</span>
      {model.displayName !== model.name && (
        <code className="font-mono text-[10px] text-muted-foreground">{model.name}</code>
      )}
      {model.isDefault && (
        <Badge variant="success" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.badgeDefault")}
        </Badge>
      )}
      {model.isNew && (
        <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.badgeNew")}
        </Badge>
      )}
      {model.isBeta && (
        <Badge variant="warning" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.badgeBeta")}
        </Badge>
      )}
      {!model.isPreset && (
        <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.badgeCustom")}
        </Badge>
      )}
      {servable === false && (
        <Badge variant="warning" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.badgeNotServed")}
        </Badge>
      )}
    </span>
  );
}

/** 毫秒时间戳 → `HH:mm`；无效值返回 `—`。 */
function formatTime(ts: number): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 上下文窗口 → 人类可读（`256000` → `256K`，`1000000` → `1M`）。 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
  }
  return String(tokens);
}
