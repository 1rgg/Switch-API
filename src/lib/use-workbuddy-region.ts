import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type { Region } from "@/lib/types";

/** 承载**版本**的 URL 查询参数名。 */
const REGION_PARAM = "region";

/**
 * 当前正在查看的 WorkBuddy **版本**（国内版 / 国际版），由 URL 承载。
 *
 * ## 为什么要有它（2026-09-30 用户报障：两个模块的版本交互不一致）
 *
 * 改造前 WorkBuddy 的「API 服务」页把版本轴**摊在三个地方**：接入地址并排两行、
 * 账号池并排两张、模型清单与接入指引**各自内置一个版本 Tabs**。而 Trae 侧一直是
 * **页面级单一区域**（`?line=` + 页头切换器，各区块跟随）。同一个产品里的两个页面
 * 用两套心智模型，用户每切一次页面都要重新找「版本在哪切」。
 *
 * 现在统一到 Trae 的模式：**页面持有唯一版本，各区块跟随，子组件不再自带选择器**。
 *
 * ## 为什么不放 React state / 全局 store
 *
 * 与 `useTraeVariant` 同一理由：放 state 里会**刷新即丢**、
 * 链接不可分享、浏览器前进/后退与页面状态分歧。放进查询串后，版本成为**路由状态的一部分**，
 * 上述三条自然消解。
 *
 * ## 参数名为什么是 `region` 而不是复用 Trae 的 `line`
 *
 * 两个页面是不同路由（`/api-service` 与 `/trae/api-service`），参数互不干扰；
 * 但各自的语义不同（WorkBuddy 是**版本**，Trae 是**区域 + 程序位**），
 * 分开命名可避免「一个页面里的 `?line=` 与另一个页面的 `?line=` 含义不同」这种串味。
 *
 * ## 取值与别名
 *
 * - `cn`（默认，**不写进 URL**）：国内版。
 * - `global`：国际版；`intl` / `international` 视为同义（与 Trae 侧的宽容规则一致）。
 * - 未知值一律回落国内版。
 */
export function useWorkbuddyRegion(): [Region, (next: Region) => void] {
  const [params, setParams] = useSearchParams();

  const region = useMemo<Region>(() => {
    const raw = (params.get(REGION_PARAM) ?? "").trim().toLowerCase();
    return raw === "global" || raw === "intl" || raw === "international" ? "global" : "cn";
  }, [params]);

  const setRegion = useCallback(
    (next: Region) => {
      setParams(
        (prev) => {
          const draft = new URLSearchParams(prev);
          if (next === "cn") {
            // 默认版本**不写进 URL**：让「默认」与「显式指定」产生同一个 URL，
            // 避免两条看起来不同的链接其实等价、也避免默认值污染可读性。
            draft.delete(REGION_PARAM);
          } else {
            draft.set(REGION_PARAM, next);
          }
          return draft;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [region, setRegion];
}
