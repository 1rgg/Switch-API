import { VariantSwitch } from "@/components/variant-switch";
import { useT } from "@/lib/i18n";
import { REGIONS, regionDescriptor } from "@/lib/region";
import type { Region } from "@/lib/types";
import { useWorkbuddyRegion } from "@/lib/use-workbuddy-region";

/**
 * WorkBuddy 分区内部的**版本切换器**（国内版 / 国际版）。
 *
 * ## 它存在的意义：把散落的版本轴收成一个
 *
 * 改造前这个版本轴散在页面各处：接入地址并排两行、账号池并排两张、
 * 模型清单与接入指引各自内置一个 Tabs。同一页面上「版本」出现在四个地方、
 * 且四处**互不联动** —— 用户在模型清单里切到国际版，上面的账号池还停在国内版。
 *
 * 现在与 Trae 侧一致：**页头唯一入口，整页跟随**。
 *
 * ## 载体仍是 URL 的 `?region=`
 *
 * 不做成组件内部 state：版本必须能刷新保持、能被分享、能配合前进后退
 * （详见 `useWorkbuddyRegion` 的说明）。本组件只是它的一个「可视化 + 可点击」的外壳。
 *
 * ## 视觉与 Trae 侧共用 [`VariantSwitch`]
 *
 * 只有一处**语义**差异：Trae 的切换器要显示「本机装了哪几条线、登录了没」
 * （它的区域对应不同客户端进程，那是真实信息）；WorkBuddy 的两个版本是同一客户端下的
 * 两种**数据域**，恒存在 ⇒ **不传 `presence`**（不渲染圆点，而不是渲染一个永远同色的假圆点）。
 */
export function WorkbuddyRegionSwitch({ className }: { className?: string }) {
  const t = useT();
  const [region, setRegion] = useWorkbuddyRegion();

  return (
    <VariantSwitch
      className={className}
      value={region}
      onChange={(next) => setRegion(next as Region)}
      ariaLabel={t("wbStats.gateway.regionSwitchAria")}
      items={REGIONS.map((item) => ({
        value: item,
        label: regionDescriptor(item).versionLabel,
      }))}
    />
  );
}
