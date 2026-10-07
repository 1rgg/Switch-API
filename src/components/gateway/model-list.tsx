import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { CreditSortHeader } from "@/components/gateway/credit-sort-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DemoAction } from "@/components/demo-action";
import * as api from "@/lib/api";
import { nextCreditSort, sortByCredits, type CreditSortDirection } from "@/lib/credit-sort";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/locales/zh";
import type {
  CatalogModel,
  CatalogSource,
  EffortCapabilityTable,
  ModelEffortCapability,
  Region,
} from "@/lib/types";
import { useGatewayStore } from "@/stores/gateway";

/** 只存键不存文案：语言切换时整张表才会跟着变。 */
const SOURCE_LABEL: Record<CatalogSource, { labelKey: TranslationKey; variant: "success" | "secondary" | "warning" }> = {
  live: { labelKey: "wbStats.gateway.sourceLive", variant: "success" },
  cached: { labelKey: "wbStats.gateway.sourceCached", variant: "secondary" },
  builtin: { labelKey: "wbStats.gateway.sourceBuiltin", variant: "warning" },
};

/** 区域 → 全限定模型名的前缀（参照 workbuddy2api-panel 的 `cn:hy4-preview-f` 写法）。 */
const REGION_PREFIX: Record<Region, string> = { cn: "cn", global: "global" };

/**
 * 倍率列排序控件所需的文案键。
 *
 * 存**键**而不是文案：本表在语言切换时要跟着整表重渲染，把中文写进模块级常量
 * 会让切换失效（与 `SOURCE_LABEL` 同一条约定）。
 *
 * 与 Trae 侧传的是**另一套键**（`trae.gateway.models.*`），但语义逐条对应 ——
 * 两个组件共用同一个 `CreditSortHeader`，只有词表命名空间不同。
 */
const CREDIT_SORT_LABELS = {
  column: "wbStats.gateway.colCredits",
  sortLabel: "wbStats.gateway.creditSort",
  toAsc: "wbStats.gateway.creditSortAsc",
  toDesc: "wbStats.gateway.creditSortDesc",
  toNone: "wbStats.gateway.creditSortNone",
  tip: "wbStats.gateway.creditSortTip",
} as const satisfies Record<string, TranslationKey>;

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 从倍率字符串里抠出数值：`"x0.79"` / `"x1.62 credits"` / `"0.5"` → 数值。
 *
 * 上游把倍率塞在一个**自由文本**字段里（`credits`），实测同时存在
 * `x0.79`、`x0.11 credits`、`x0.00` 三种写法，前缀 `x` 与后缀 `credits`
 * 都只是修饰。因此这里只取第一个数值字面量，取不到返回 `null` ——
 * 调用方据此区分「免费（0）」和「没有倍率数据（null）」，这两件事不能混。
 *
 * 注意 `x0.00` 与 `null` 语义不同：前者是**有**倍率且为 0（免费），
 * 后者是上游压根没给。所以**不能**用 `parseFloat` 的返回值判空。
 */
function creditValue(credits: string | null | undefined): number | null {
  if (!credits) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(credits);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 倍率分档：数字按「便宜 → 贵」着色，一眼看出哪个模型划算。
 *
 * 档位是按**实测倍率分布**切的（数据来自 `~/.buddy-switch/gateway_models.*.json`）：
 * 国际版跨 0.00–6.67，国内版集中在 0.00–1.62，因此上档线取 1 / 3 两个断点，
 * 让两版的中间档都能落在同一套色阶里，而不是国内版全绿、国际版全红。
 */
function creditTier(value: number): "free" | "low" | "mid" | "high" {
  if (value <= 0) return "free";
  if (value < 1) return "low";
  if (value < 3) return "mid";
  return "high";
}

/** 分档 → 边框/底色/文字色。刻意用 Tailwind 原色而非主题令牌：
 *  这三档表达的是「便宜/中等/贵」的**绝对**语义，不该随主题令牌变。 */
const CREDIT_TIER_CLASS: Record<ReturnType<typeof creditTier>, string> = {
  free: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  mid: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-700",
};

/**
 * 「积分倍率」单元格（参照 `workbuddy2api-panel` 的同名列）。
 *
 * 那个面板把倍率做成**整列**并支持按倍率排序，参考页上也带了促销标签
 * （`限时免费` / `夜间折扣` / `错峰使用`）。这里对齐的信息口径是：
 * **倍率数字为主，促销 / 免费标签跟随在同一格内**。
 *
 * 排序控件**已于 2026-10-07 落地**（列头可点，三态）—— 见 `CreditSortHeader`
 * 与 `lib/credit-sort.ts`。两个产品共用同一套排序语义。
 *
 * ⚠️ 倍率 `0` 与「没有倍率」必须分开：前者是免费（`0x`），后者显示 `—`。
 * 早先这里踩过坑 —— 上游用自由文本，若把文案塞进 `credits` 就会抠不出数字，
 * 于是每条都退化成 `—`（见 `screenshot-demo.ts` 的 `demoCatalog` 注释）。
 * 排序时同理：`null` 沉底，**绝不**当 `0` 排到最前（那是最危险的「省钱侧错值」）。
 */
function CreditCell({ model }: { model: CatalogModel }) {
  const t = useT();
  const value = creditValue(model.credits);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value === null ? (
        // 无倍率（如 `auto`）不是错误，只是没这个口径 —— 与「倍率 0」区分开。
        <span className="font-mono text-xs text-muted-foreground/60" title={t("wbStats.gateway.creditNone")}>
          —
        </span>
      ) : (
        <span
          data-credits={value}
          title={t("wbStats.gateway.creditTitle", { value: model.credits ?? String(value) })}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-xs leading-4 tabular-nums",
            CREDIT_TIER_CLASS[creditTier(value)],
          )}
        >
          {model.credits}
        </span>
      )}
      {model.free && (
        <Badge variant="success" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("wbStats.gateway.free")}
        </Badge>
      )}
      {model.badges.map((badge) => (
        <Badge key={badge} variant="warning" className="rounded-md px-1.5 py-0 text-[10px]">
          {badge}
        </Badge>
      ))}
    </div>
  );
}

/** 单个档位的徽章。`default` 那档额外高亮 —— 参考页上也把默认档标了出来。 */
function EffortBadge({ effort, isDefault }: { effort: string; isDefault: boolean }) {
  return (
    <span
      data-effort={effort}
      data-effort-default={isDefault ? "yes" : "no"}
      className={cn(
        "rounded border px-1.5 py-0 text-[10px] leading-4",
        isDefault
          ? "border-primary/40 bg-primary/10 font-medium text-primary"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {effort}
      {isDefault && <span className="ml-1 opacity-70">·</span>}
    </span>
  );
}

/**
 * 「默认档」单元格。
 *
 * 单档模型（如 `kimi-k3-1` 只有 `medium`）按参考页的写法显示「固定档：medium」，
 * 因为此时「默认」没有选择意义 —— 用户能选的只有那一档。
 *
 * `default_declared === false` 时标「推断」：后端在静态表未声明默认档时会兜底成
 * `high`（见 `effort.rs` 的 `DEFAULT_DEEPSEEK_EFFORT`），把它当上游声明值展示会误导。
 */
function DefaultEffortCell({ capability }: { capability: ModelEffortCapability | null }) {
  const t = useT();

  if (!capability) {
    return <span className="text-xs text-muted-foreground/60" title={t("wbStats.gateway.effortNone")}>—</span>;
  }

  // 只有一档 → 没有「默认」的概念，按参考页写「固定档：X」。
  if (capability.efforts.length === 1) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("wbStats.gateway.effortFixed", { effort: capability.efforts[0] })}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        data-effort-default-of={capability.default_effort}
        title={t("wbStats.gateway.effortDefaultTip", { effort: capability.default_effort })}
        className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0 font-mono text-[10px] leading-4 font-medium text-primary"
      >
        {capability.default_effort}
      </span>
      {!capability.default_declared && (
        <span
          title={t("wbStats.gateway.effortInferredTip")}
          className="rounded border border-border bg-muted/50 px-1.5 py-0 text-[10px] leading-4 text-muted-foreground"
        >
          {t("wbStats.gateway.effortInferred")}
        </span>
      )}
    </div>
  );
}

/** 「支持的思考档位」单元格：列出全部支持档，默认档高亮。 */
function EffortsCell({ capability }: { capability: ModelEffortCapability | null }) {
  const t = useT();

  if (!capability || capability.efforts.length === 0) {
    return <span className="text-xs text-muted-foreground/60" title={t("wbStats.gateway.effortNone")}>—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {capability.efforts.map((effort) => (
        <EffortBadge key={effort} effort={effort} isDefault={effort === capability.default_effort} />
      ))}
    </div>
  );
}

/** 「模型」单元格：全限定名 / 显示名 + 模型 id / 能力标签（参照参考页的三行结构）。 */
function ModelCell({ model, region }: { model: CatalogModel; region: Region }) {
  const t = useT();
  // 「工具」：WorkBuddy 的模型清单未下发 function-calling 能力，一律不下结论，
  // 只标「是否支持图片」。参考页那列还带「思考常开」，本仓无对应字段，故不编。
  return (
    <div className="min-w-[15rem] space-y-1">
      <code className="block font-mono text-xs font-semibold text-foreground">
        {t("wbStats.gateway.qualifiedId", { region: REGION_PREFIX[region], id: model.id })}
      </code>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-xs text-muted-foreground">{model.name}</span>
        {model.id !== model.name && (
          <code className="font-mono text-[10px] text-muted-foreground/70">{model.id}</code>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "rounded border px-1.5 py-0 text-[10px] leading-4",
            model.supports_images
              ? "border-border bg-muted/50 text-muted-foreground"
              : "border-border/60 bg-transparent text-muted-foreground/60",
          )}
        >
          {model.supports_images ? t("wbStats.gateway.capVision") : t("wbStats.gateway.capNoVision")}
        </span>
      </div>
    </div>
  );
}

/**
 * 模型列表：展示来源徽标（实时 / 已保存 / 内置）与刷新按钮（P0-4 / P0-12 / P1-7）。
 *
 * ## 版式参照 `workbuddy2api-panel`（表格，2026-10-07 起）
 *
 * 原先这里是**胶囊流式排版**（一行内多个 chip 换行）。改为参考页的**表格**：
 * 「模型 / 积分倍率 / 默认档 / 支持的思考档位 / 上下文长度 / 最大输出」六列。
 *
 * 改成表格的**理由**是可读性而非跟风：胶囊排版下每个模型的字段长度差异很大
 * （有的带 3 个徽标、有的没有），横向对齐被人为破坏，「哪个模型上下文更长」
 * 这类**跨行比较**必须逐条读数字；表格把同一字段对齐到一列，比较变成扫一列。
 *
 * ## 每个条目同时显示**模型 id**（与 Trae 侧同口径）
 *
 * 展示名（`CatalogModel.name`，如 `DeepSeek-V4-Pro`）与模型 id
 * （`CatalogModel.id`，如 `deepseek-v4-pro`）**不是同一个值**：配置 API Key、
 * 写各客户端接入配置时，真正要填的是 **id**。本表第一列同时给出
 * **全限定名**（`cn:deepseek-v4-pro`，照参考页写法）、展示名与 id。
 *
 * ## 档位两列的数据来源与 `/models` 不是一条
 *
 * 「默认档 / 支持的思考档位」来自后端**编译期静态表**
 * （`buddy-switch-gateway` 的 `outbound/effort.rs`，按 region 分 CN / Global 两张），
 * 与上游目录（`credits` / `context_window` 那些）生命周期不同：
 * 目录会随账号刷新、可能失败；档位表永不变化、不依赖账号。
 * 因此两者**分开取**，档位取不到时只让那两列显示 `—`，不影响整表。
 *
 * ## 「积分倍率」列可排序（2026-10-07 新增）
 *
 * 列头是可点的按钮，三态循环：不排序 → 从低到高 → 从高到低 → 不排序。
 * 状态机与比较器在 `lib/credit-sort.ts`，与 Trae 侧**共用同一份** ——
 * 两页的表要逐列对读，排序语义不能各写一套。
 *
 * 不排序态**必须保留**：上游下发的原始顺序本身带信息，点过排序就回不去
 * 等于把「别排」这个选项删掉。且**无倍率的行永远沉底**（两个方向都是）——
 * 它们是「没这个口径」，不是「最便宜」，排到前面会诱导用户以为它们划算。
 */
export function ModelList({ region, className }: { region: Region; className?: string }) {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const [efforts, setEfforts] = useState<EffortCapabilityTable | null>(null);
  /**
   * 「积分倍率」列的排序方向（三态：无 / 升 / 降）。
   *
   * 不落 store / 不落 URL —— 与 Trae 侧的 `onlyServed` 同属「本卡片的展示参数」，
   * 切页回来复位到「不排序」（更保守的一侧：还原上游原始顺序）。
   */
  const [creditSort, setCreditSort] = useState<CreditSortDirection>(null);
  const snapshot = useGatewayStore((s) => s.models[region]);
  const refreshModels = useGatewayStore((s) => s.refreshModels);

  /**
   * 档位表一次性取回（整表，不是逐模型查）。
   *
   * 失败**不报错**：它只影响两列的展示，报错反而干扰用户 ——
   * 与「上游目录取不到」是两种严重程度，不该同一待遇。
   * 依赖只有 region：档位表是静态的，刷新模型列表不必重取。
   */
  useEffect(() => {
    let alive = true;
    setEfforts(null);
    api
      .getGatewayEfforts(region)
      .then((table) => {
        if (alive) setEfforts(table);
      })
      .catch(() => {
        // 静默失败：两列退化为 `—`，其余列照常展示。
      });
    return () => {
      alive = false;
    };
  }, [region]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshModels(region);
      toast.success(t("wbStats.gateway.refreshed"));
    } catch (e) {
      toast.error(t("wbStats.gateway.refreshFail"), { description: api.asError(e) });
    } finally {
      setRefreshing(false);
    }
  }

  const source = snapshot ? SOURCE_LABEL[snapshot.source] : null;
  const models = snapshot?.models ?? [];
  /**
   * 实际渲染的模型顺序。
   *
   * 排序**只影响展示**，不动 `snapshot`（数据源是 store 里的快照，改它就是改全局态）。
   * `creditValue` 在这里做「字符串 → 数值」的解析：WorkBuddy 的倍率是**自由文本**
   * （`"x0.79"` / `"x0.08 credits"`），解析不出来的（如 `auto`）返回 `null`，
   * 由 `sortByCredits` 保证它们沉底。
   */
  const shownModels = sortByCredits(models, (model) => creditValue(model.credits), creditSort);

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        {/* 版本不在这里显示也不在这里切：页头切换器是唯一入口（与 Trae 侧同口径）。 */}
        <span className="text-sm font-semibold">{t("wbStats.gateway.modelList")}</span>
        <DemoAction>
          <Button variant="ghost" size="sm" onClick={() => void onRefresh()} disabled={refreshing}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("wbStats.gateway.refresh")}
          </Button>
        </DemoAction>
      </div>

      <div className="px-5 py-4">
        {source && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {t("wbStats.gateway.source")}
              <Badge variant={source.variant} className="rounded-md">
                {t(source.labelKey)}
              </Badge>
            </span>
            <span>{t("wbStats.gateway.updatedAt", { time: formatTime(snapshot?.fetched_at ?? null) })}</span>
            <span>{t("wbStats.gateway.modelsCount", { n: models.length })}</span>
          </div>
        )}
        {snapshot?.note && <p className="mb-3 text-xs text-amber-600">{snapshot.note}</p>}
        {models.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("wbStats.gateway.noModels")}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{t("wbStats.gateway.tableHint")}</p>
            {/* 窄屏横向滚动：六列在 720px 最小窗口下放不开，宁可滚动也不压字。 */}
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[54rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/60 text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("wbStats.gateway.colModel")}</th>
                    <CreditSortHeader
                      direction={creditSort}
                      onToggle={() => setCreditSort((d) => nextCreditSort(d))}
                      labels={CREDIT_SORT_LABELS}
                    />
                    <th className="py-2 pr-4 font-medium">{t("wbStats.gateway.colDefaultEffort")}</th>
                    <th className="py-2 pr-4 font-medium">{t("wbStats.gateway.colEfforts")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("wbStats.gateway.colContext")}</th>
                    <th className="py-2 text-right font-medium">{t("wbStats.gateway.colMaxTokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownModels.map((model) => {
                    // 档位表按**上游 id**（小写）匹配，不能拿展示名查表。
                    const capability = efforts?.[model.id] ?? null;
                    return (
                      <tr
                        key={model.id}
                        // 验收钩子：CDP 场景据此逐个断言模型 id，不必靠文案 / className 反查。
                        data-model={model.id}
                        className="border-b border-border/40 last:border-b-0 align-top"
                      >
                        <td className="py-3 pr-4">
                          <ModelCell model={model} region={region} />
                        </td>
                        <td className="py-3 pr-4">
                          <CreditCell model={model} />
                        </td>
                        <td className="py-3 pr-4">
                          <DefaultEffortCell capability={capability} />
                        </td>
                        <td className="py-3 pr-4">
                          <EffortsCell capability={capability} />
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatTokens(model.context_window)}
                        </td>
                        <td className="py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatTokens(model.max_tokens)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** 上下文 / 输出长度 → 人类可读（`131072` → `128K`，`1000000` → `1M`）。 */
function formatTokens(tokens: number): string {
  if (!tokens) return "—";
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
