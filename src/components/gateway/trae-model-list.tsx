import { useEffect, useState } from "react";
import { Cpu, Loader2, RefreshCw } from "lucide-react";

import { CreditSortHeader } from "@/components/gateway/credit-sort-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DemoAction } from "@/components/demo-action";
import { TraeVariantMark } from "@/components/product-marks";
import * as api from "@/lib/api";
import { nextCreditSort, sortByCredits, type CreditSortDirection } from "@/lib/credit-sort";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/locales/zh";
import type { Region, EffortCapabilityTable, ModelEffortCapability } from "@/lib/types";
import type {
  TraeClientModel,
  TraeClientModelGroup,
  TraeModelSource,
  TraeVariantId,
} from "@/lib/trae-types";

/**
 * 程序位标识 → 档位表所属**区域**。
 *
 * 档位表（`crates/buddy-switch-gateway/src/outbound/effort.rs`）按 region 分两张，
 * 而本卡的取数轴是**程序位**（TraeWork / TraeCode）。两者是两条正交的轴
 * （区域 = 账号体系，程序位 = 客户端），所以这里必须显式把程序位映回区域 ——
 * 按 `variant` 名字里有没有 `global` 前缀猜是不可靠的（`trae_cn` 那一条
 * 名字里既没有 `cn` 也没有 `global`）。
 *
 * 与 `traeRegionLabelOf` 同源（那里是「程序位 → 区域展示名」，这里是「→ 区域标识」），
 * 两处必须一致：新增程序位时两个 switch 都要补。
 */
function programRegion(variant: TraeVariantId): Region {
  switch (variant) {
    case "global":
    case "global_trae_code":
      return "global";
    // 国内两条程序位（`trae_work` / `trae_cn`）同属国内区域。
    default:
      return "cn";
  }
}

/**
 * 倍率列排序控件所需的文案键。
 *
 * 存**键**而不是文案：语言切换时整表要重渲染，把中文写进模块级常量会让切换失效。
 *
 * 与 WorkBuddy 侧传的是**另一套键**（`wbStats.gateway.*`），但语义逐条对应 ——
 * 两个组件共用同一个 `CreditSortHeader`，只有词表命名空间不同。
 */
const CREDIT_SORT_LABELS = {
  column: "trae.gateway.models.colCredits",
  sortLabel: "trae.gateway.models.creditSort",
  toAsc: "trae.gateway.models.creditSortAsc",
  toDesc: "trae.gateway.models.creditSortDesc",
  toNone: "trae.gateway.models.creditSortNone",
  tip: "trae.gateway.models.creditSortTip",
} as const satisfies Record<string, TranslationKey>;

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
 *
 * ## 版式参照 `workbuddy2api-panel`（表格，2026-10-07 起）
 *
 * 原先这里是**胶囊流式排版**（每个 function 分组内一行 chip 换行）。改为参考页的
 * **六列表格**：「模型 / 积分倍率 / 默认档 / 支持的思考档位 / 上下文长度 / 最大输出」，
 * 与同页的 WorkBuddy 模型表**逐字同列**。
 *
 * 改成表格的理由与那侧相同 —— 可读性。胶囊排版下每个模型的字段长度差异极大
 * （有的带 5 个徽标、有的没有），横向对齐被人为破坏，「哪个模型上下文更长」
 * 这类**跨行比较**必须逐条读数字；表格把同一字段对齐到一列，比较变成扫一列。
 *
 * ⚠️ 分组（`function`）**保留**：Trae 的清单是「按 function 分组」下发的，
 * 而网关只用本程序位那一个 function 发请求 —— 分组是「能不能调」的**结构性**依据，
 * 不能因为改版式就丢掉。表格因此**每分组一张**（分组标题在上、表头在下）。
 * 合成一张大表会让「这条属于哪个 function」从分组标题掉进某一列，
 * 而这一列在参考页上并不存在，属于为了让版式统一而引入的新列。
 *
 * ## 积分倍率列：**有真实数据**（2026-10-07 修正，推翻上一版）
 *
 * 上一版这里写着「Trae 上游清单没有 `credits` 字段，本列恒为 `—`，留空位只为
 * 列结构对齐」。**那个结论是错的，已在 2026-10-07 实测推翻。**
 *
 * 倍率一直都在，位置是 `features.consumption_rate.data.rate` —— 一个**嵌套
 * 对象**里。上一轮排查之所以漏掉，是因为只枚举了模型条目的**顶层**字段名
 * 再去搜 `credit|cost|price|rate` 关键词，而顶层 55 个字段名里一个都不含
 * 这些词，整层被跳过。
 *
 * ⇒ **教训：判断「某能力有没有」不能只看顶层键名。** 复杂对象（`features`
 * 这种）必须递归进去看，否则漏掉的是整块能力，而不是一个字段。
 *
 * 实测 TraeWork 客户端 32 个模型里 **26 个有倍率**（0.06–1.83），
 * 没有的 6 个全是第三方 / 自定义路由条目。
 *
 * ## 「积分倍率」列可排序（2026-10-07 新增）
 *
 * 列头是可点的按钮，三态循环：不排序 → 从低到高 → 从高到低 → 不排序，
 * 与 WorkBuddy 侧**共用同一份**状态机 / 比较器（`lib/credit-sort.ts`）
 * 与表头组件（`CreditSortHeader`）—— 两页的表要逐列对读，排序语义不能各写一套。
 *
 * 两个要点：
 * - **不排序态必须保留**：上游原始顺序本身带信息（客户端按 function 下发），
 *   点过就回不去等于把「别排」这个选项删掉；
 * - **无倍率的行永远沉底**（两个方向都是）：它们是「没这个口径」，不是「最便宜」。
 *
 * ⚠️ 排序**在各分组内独立进行**，绝不跨分组重排 —— 分组是「能不能调」的
 * 结构性依据，打散了就把这条信息从分组标题里弄丢了。
 *
 * ## 「网关不提供」的行：默认**保留**（压暗 + 记号），可一键隐藏
 *
 * 清单来自客户端缓存，是用户**唯一**一份「上游到底下发了什么」的现场证据。
 * 那批不属于本程序位 `function` 的条目（实测 `solo_coder` / 第三方路由）
 * 是**真在客户端里的** —— 直接抹掉会让人以为客户端里根本没有它，
 * 而实际情况是「有、但本网关这条线调不动」，两者要采取的处置完全不同
 * （前者去找客户端版本，后者去换程序位或换模型）。
 *
 * ⇒ 默认全部保留、压暗并打「网关不提供」记号（`servable === false`）；
 *   开关打开时才整行隐藏，并**显式写出隐藏了几条** ——
 *   隐藏而不报数，就是换了种方式的「看不见」。
 *
 * 两种模式都**不改数据源**：`gatewayNames` 是后端按 `function` 过滤 + 剔除
 * `is_bypass` 之后的结果（见 Rust 侧 `payload::servable_entries`），
 * 前端只做「显不显示」这一层。
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
  /**
   * 是否隐藏「网关不提供」的行。
   *
   * **默认关**（保留全部行，压暗 + 记号）—— 见模块头那节：客户端缓存是用户唯一一份
   * 「上游下发了什么」的证据，默认隐藏等于把证据藏起来。
   *
   * 不落 store / 不落 URL：与 `picked` 同属「本卡片的展示参数」，切页回来复位是可接受的
   * （且复位到「看得见全部」这个更保守的一侧）。
   */
  const [onlyServed, setOnlyServed] = useState(false);
  /**
   * 「积分倍率」列的排序方向（三态：无 / 升 / 降）。
   *
   * 与 `onlyServed` 同属「本卡片的展示参数」：不落 store / 不落 URL，
   * 切页回来复位到「不排序」（还原上游原始顺序这个更保守的一侧）。
   */
  const [creditSort, setCreditSort] = useState<CreditSortDirection>(null);
  const active = sources.find((source) => source.variant === picked) ?? sources[0] ?? null;
  const data = active?.data ?? null;
  /** 当前程序位的**网关对外清单** id 集合（见 `TraeModelSource.gatewayNames`）。 */
  const servableNames = active?.gatewayNames ? new Set(active.gatewayNames) : null;
  const gatewayCount = active?.gatewayNames?.length ?? null;

  /**
   * 档位表（`reasoning_effort` 的支持档位与默认档）。
   *
   * 与上游目录**不是一条数据源**：档位表是后端编译期静态表（`effort.rs`），
   * 不随客户端刷新而变、永不失败；目录读的是客户端缓存，可能读不到。
   * 因此分开取，档位取不到只让那两列显示 `—`，不影响整表。
   *
   * 取的是**整表**（一次一把），不是逐模型查 —— 一个程序位几十个模型，
   * 逐条查会打出几十次 IPC。依赖是**区域**（不是程序位）：同一区域下的
   * TraeWork / TraeCode 共用一张表，切程序位不必重取。
   */
  const [efforts, setEfforts] = useState<EffortCapabilityTable | null>(null);
  const region = active ? programRegion(active.variant) : null;

  useEffect(() => {
    if (!region) {
      setEfforts(null);
      return;
    }
    let alive = true;
    setEfforts(null);
    api
      .getGatewayEfforts(region)
      .then((table) => {
        if (alive) setEfforts(table);
      })
      .catch(() => {
        // 静默失败：两列退化为 `—`，其余列照常展示。与「上游目录读不到」
        // 是两种严重程度 —— 后者会让整卡空态，前者只是少两列口径。
      });
    return () => {
      alive = false;
    };
  }, [region]);

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

  /**
   * 实际渲染用的分组。
   *
   * 过滤（`onlyServed`）与排序（`creditSort`）**都在这里一次做完**，
   * 且**排序在各分组内独立进行** —— 分组是「能不能调」的**结构性**依据
   * （见模块头），把模型按倍率抽出来跨分组重排会让「这条属于哪个 function」
   * 从分组标题掉进某一列，而那列在参考页上并不存在。
   *
   * 只在开关打开时过滤；`servableNames === null`（网关清单没取到）时**不过滤** ——
   * 判据缺失就把行删掉，等于把「没读到」当成「不提供」，那是凭空造结论。
   *
   * 排序前先过滤、后排序：顺序反过来只是多排几个马上被丢掉的行，结果相同，
   * 但「先过滤」读起来更贴近「这张表最终长什么样」。
   */
  const filterable = onlyServed && servableNames !== null;
  const shownGroups: TraeClientModelGroup[] = groups
    .map((group) => ({
      ...group,
      models: sortByCredits(
        filterable ? group.models.filter((model) => servableNames.has(model.name)) : group.models,
        (model) => model.credits,
        creditSort,
      ),
    }))
    // 只有**开着过滤**时才丢掉被过滤空的分组（那是我自己删空的）；
    // 不过滤时哪怕某分组本来就空，也要原样留着 —— 空分组本身是上游的事实。
    .filter((group) => !filterable || group.models.length > 0);

  /**
   * 被隐藏的**去重**条数（不是各行相加 —— 同一模型会在多个分组里重复）。
   *
   * 归类时以「该模型在**任一**分组里可服务」为准，与渲染时的逐行过滤口径一致：
   * 只看某一分组会把它算成「隐藏」，而它在别的分组里其实还在表上。
   */
  const hiddenCount = filterable
    ? total -
      new Set(
        shownGroups.flatMap((group) => group.models.map((model) => model.name)),
      ).size
    : 0;

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
          {/* 「只看网关提供的模型」：判据（`servableNames`）没取到时**不渲染**这个控件 ——
              一个拨不动任何东西的开关比没有开关更糟。 */}
          {servableNames !== null && (
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
              title={t("trae.gateway.models.onlyServedTip")}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={onlyServed}
                onChange={(event) => setOnlyServed(event.target.checked)}
                data-only-served={onlyServed ? "on" : "off"}
              />
              {t("trae.gateway.models.onlyServed")}
            </label>
          )}
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
            {hiddenCount > 0 && (
              <span className="text-amber-600">
                {t("trae.gateway.models.hiddenCount", { count: hiddenCount })}
              </span>
            )}
          </div>
        )}

        {data?.note && <p className="mb-3 text-xs text-amber-600">{data.note}</p>}

        {!loaded ? (
          <p className="py-4 text-sm text-muted-foreground">{t("trae.gateway.models.empty")}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{t("trae.gateway.models.tableHint")}</p>
            <div className="space-y-5">
              {shownGroups.map((group) => (
                <section key={group.function} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs text-muted-foreground">{group.function}</code>
                    <span className="text-xs text-muted-foreground">
                      {t("trae.gateway.models.groupCount", { count: group.models.length })}
                    </span>
                  </div>
                  {/* 窄屏横向滚动：六列在 720px 最小窗口下放不开，宁可滚动也不压字。 */}
                  <div className="-mx-1 overflow-x-auto">
                    <table className="w-full min-w-[54rem] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-border/60 text-xs text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">
                            {t("trae.gateway.models.colModel")}
                          </th>
                          <CreditSortHeader
                            direction={creditSort}
                            onToggle={() => setCreditSort((d) => nextCreditSort(d))}
                            labels={CREDIT_SORT_LABELS}
                          />
                          <th className="py-2 pr-4 font-medium">
                            {t("trae.gateway.models.colDefaultEffort")}
                          </th>
                          <th className="py-2 pr-4 font-medium">
                            {t("trae.gateway.models.colEfforts")}
                          </th>
                          <th className="py-2 pr-4 text-right font-medium">
                            {t("trae.gateway.models.colContext")}
                          </th>
                          <th className="py-2 text-right font-medium">
                            {t("trae.gateway.models.colMaxTokens")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.models.map((model) => {
                          // 档位表按**上游 id**（小写）匹配，不能拿展示名查表。
                          const capability = efforts?.[model.name] ?? null;
                          const servable =
                            servableNames === null ? null : servableNames.has(model.name);
                          return (
                            <tr
                              key={model.name}
                              // 验收钩子（**保留原语义**）：CDP 场景据此逐个断言
                              // 「这个模型网关到底提不提供」，不必靠 className / 文案反查
                              // —— 那两者都会随样式漂移。
                              data-model={model.name}
                              data-served={
                                servable === null ? "unknown" : servable ? "yes" : "no"
                              }
                              className={cn(
                                "border-b border-border/40 last:border-b-0 align-top",
                                // 网关调不到的模型压暗：仍可看到（它确实在客户端里），
                                // 但一眼知道不能调。整行压暗替代原先 chip 的虚线边框。
                                servable === false && "opacity-60",
                              )}
                            >
                              <td className="py-3 pr-4">
                                <ModelCell model={model} servable={servable} />
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
                                {model.contextWindow === null
                                  ? "—"
                                  : formatTokens(model.contextWindow)}
                              </td>
                              <td className="py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                {model.promptMaxTokens === null
                                  ? "—"
                                  : formatTokens(model.promptMaxTokens)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * 「模型」单元格：模型名（调用时真正要传的）为主，展示名跟随，再一行能力/状态徽标。
 *
 * 与 WorkBuddy 侧**刻意不同**：那侧首行是**全限定名**（`cn:deepseek-v4-pro`），
 * 因为它的上游目录确实带区域前缀的写法。Trae 的上游清单**没有**这个前缀概念
 * —— 客户端里就是裸 `name`，网关 `/v1/models` 也原样透出裸 `name`。
 * 这里替用户发明一个 `cn:` 前缀会让「界面上写的」与「实际要填的」**反而不一致**，
 * 所以首行直接放裸 id。
 */
function ModelCell({ model, servable }: { model: TraeClientModel; servable: boolean | null }) {
  const t = useT();

  return (
    <div className="min-w-[15rem] space-y-1">
      <code className="block font-mono text-xs font-semibold text-foreground">{model.name}</code>
      {model.displayName !== model.name && (
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">{model.displayName}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {/* 多模态：Trae 清单里**有**这个字段（`multimodal`），因此这里能下结论 ——
            与 WorkBuddy 侧「没有 function-calling 字段就不标」是同一条原则：
            有字段才标，没字段就不编。 */}
        <span
          className={cn(
            "rounded border px-1.5 py-0 text-[10px] leading-4",
            model.multimodal
              ? "border-border bg-muted/50 text-muted-foreground"
              : "border-border/60 bg-transparent text-muted-foreground/60",
          )}
        >
          {model.multimodal ? t("trae.gateway.models.capVision") : t("trae.gateway.models.capNoVision")}
        </span>
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
      </div>
    </div>
  );
}

/**
 * 倍率分档：数字按「便宜 → 贵」着色，一眼看出哪个模型划算。
 *
 * **与 WorkBuddy 侧同一套断点（1 / 3）** —— 两页的倍率列可以直接逐行对读，
 * 色阶语义必须一致，否则用户会以为「绿色」在两页代表不同的价位。
 *
 * 档位切点取自两版合并后的实测分布（Trae 实测 0.06–1.83，WorkBuddy 国内
 * 0.00–1.62 / 国际 0.00–6.67）：断点落在 1 与 3，能让三档都有人落进去。
 */
function creditTier(value: number): "free" | "low" | "mid" | "high" {
  if (value <= 0) return "free";
  if (value < 1) return "low";
  if (value < 3) return "mid";
  return "high";
}

/** 分档 → 边框/底色/文字色。刻意用 Tailwind 原色而非主题令牌：
 *  这三档表达的是「便宜/中等/贵」的**绝对**语义，不该随主题令牌变。
 *  **与 WorkBuddy 侧逐字相同**（见 `model-list.tsx` 的同名常量）。 */
const CREDIT_TIER_CLASS: Record<ReturnType<typeof creditTier>, string> = {
  free: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  mid: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-700",
};

/**
 * 「积分倍率」单元格。
 *
 * ## 2026-10-07：本列从恒为 `—` 改为**真实倍率**（推翻了上一版的裁定）
 *
 * 上一版在这里写了一整段「Trae 上游清单没有倍率口径，留空位只为列结构对齐」。
 * **那个结论是错的** —— 倍率一直都在，只是藏在 `features` 这个**嵌套对象**里，
 * 而上一轮的排查只枚举了模型条目的**顶层**字段名并搜 `credit|cost|price|rate`
 * 关键词，顶层一个都不含这些词，整层被漏掉。后端现已挖出
 * （见 Rust 侧 `ClientModel::credits` 的字段注释）。
 *
 * ## `null` 与 `0` 必须分开（与 WorkBuddy 侧同一条铁律）
 *
 * `null` = 上游没给这个口径（实测：第三方 / 自定义路由条目就没有）；
 * `0` = 上游明确说不消耗积分。前者显示 `—`，后者显示 `x0` 并标「免费」。
 * 把 `null` 渲染成 `x0` 是**最危险的错值** —— 错在「省钱」这一侧，
 * 用户会以为某模型免费而大量调用。
 *
 * ## 折扣与活动
 *
 * - `discountedCredits`（会员折后）只在**确实有折扣**时标出来，主数字仍是基础倍率；
 * - `hasActivityDiscount` 只出一个「限时」标签，**不显示活动价** ——
 *   活动是限时的，把活动价当常规倍率展示，活动一结束界面就在说谎。
 */
function CreditCell({ model }: { model: TraeClientModel }) {
  const t = useT();
  const value = model.credits;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value === null ? (
        <span className="font-mono text-xs text-muted-foreground/60" title={t("trae.gateway.models.creditNone")}>
          —
        </span>
      ) : (
        <span
          data-credits={value}
          title={t("trae.gateway.models.creditTitle", { value: formatRate(value) })}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-xs leading-4 tabular-nums",
            CREDIT_TIER_CLASS[creditTier(value)],
          )}
        >
          x{formatRate(value)}
        </span>
      )}
      {value === 0 && (
        <Badge variant="success" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.creditFree")}
        </Badge>
      )}
      {model.discountedCredits !== null && model.discountedCredits !== value && (
        <span
          title={t("trae.gateway.models.creditDiscountedTip", {
            value: formatRate(model.discountedCredits),
          })}
          className="rounded border border-border bg-muted/50 px-1.5 py-0 text-[10px] leading-4 text-muted-foreground"
        >
          {t("trae.gateway.models.creditDiscounted", { value: formatRate(model.discountedCredits) })}
        </span>
      )}
      {model.hasActivityDiscount && (
        <Badge variant="warning" className="rounded-md px-1.5 py-0 text-[10px]">
          {t("trae.gateway.models.creditActivity")}
        </Badge>
      )}
    </div>
  );
}

/**
 * 倍率 → 显示串。
 *
 * 上游给的是 JSON 数字（`0.78` / `1.83` / `0.2`），直接 `String()` 会把
 * `0.2` 显示成 `0.2`、`1.5` 显示成 `1.5`，没问题；但浮点运算后的值可能带
 * 长尾（`0.30000000000000004`），故统一收成最多 2 位小数并去掉末尾 0
 * —— 上游实测倍率最多 2 位小数，收成 2 位不丢有效信息。
 */
function formatRate(value: number): string {
  return String(Number(value.toFixed(2)));
}


/** 单个档位的徽章。默认档那档额外高亮 —— 与 WorkBuddy 侧同款。 */
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
 * 单档模型按参考页写法显示「固定档：X」，因为此时「默认」没有选择意义。
 * `default_declared === false` 时标「推断」：后端在静态表未声明默认档时会兜底成
 * `high`，把它当上游声明值展示会误导。
 */
function DefaultEffortCell({ capability }: { capability: ModelEffortCapability | null }) {
  const t = useT();

  if (!capability) {
    return (
      <span
        className="text-xs text-muted-foreground/60"
        title={t("trae.gateway.models.effortNone")}
      >
        —
      </span>
    );
  }

  if (capability.efforts.length === 1) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("trae.gateway.models.effortFixed", { effort: capability.efforts[0] })}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        data-effort-default-of={capability.default_effort}
        title={t("trae.gateway.models.effortDefaultTip", { effort: capability.default_effort })}
        className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0 font-mono text-[10px] leading-4 font-medium text-primary"
      >
        {capability.default_effort}
      </span>
      {!capability.default_declared && (
        <span
          title={t("trae.gateway.models.effortInferredTip")}
          className="rounded border border-border bg-muted/50 px-1.5 py-0 text-[10px] leading-4 text-muted-foreground"
        >
          {t("trae.gateway.models.effortInferred")}
        </span>
      )}
    </div>
  );
}

/** 「支持的思考档位」单元格：列出全部支持档，默认档高亮。 */
function EffortsCell({ capability }: { capability: ModelEffortCapability | null }) {
  const t = useT();

  if (!capability || capability.efforts.length === 0) {
    return (
      <span
        className="text-xs text-muted-foreground/60"
        title={t("trae.gateway.models.effortNone")}
      >
        —
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {capability.efforts.map((effort) => (
        <EffortBadge key={effort} effort={effort} isDefault={effort === capability.default_effort} />
      ))}
    </div>
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
