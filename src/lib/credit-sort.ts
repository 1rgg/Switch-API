/**
 * 「积分倍率」列的排序状态机与比较器 —— WorkBuddy 与 Trae 两张模型表**共用同一份**。
 *
 * ## 为什么要抽出来
 *
 * 两个组件（`gateway/model-list.tsx` / `gateway/trae-model-list.tsx`）的表结构
 * 刻意「逐列对齐」，倍率列的排序行为自然也必须是**同一套语义** ——
 * 若各写一份，日后必有一侧悄悄漂移（例如一侧变了三态、另一侧没变），
 * 而用户看到的是同页两张表，会觉得是本页自己不一致。
 *
 * ## 三态，不是两态
 *
 * `null → asc → desc → null` 循环。**必须留「无排序」这一态**：
 * 上游给的原始顺序本身带信息（客户端按 function / 默认序下发），
 * 一旦点过排序就再也回不去原始顺序，是把用户的「我没让你排」这一选项删掉了。
 *
 * ## `null`（无倍率）永远沉底 —— 无论升序还是降序
 *
 * 这是本模块**最重要**的一条。`null` 的含义是「上游没给这个口径」，
 * 既不是「最便宜」也不是「最贵」。若在升序里把 `null` 当成 `0` 排到最前，
 * 用户会以为这些模型**最划算** —— 这正是要极力避免的「省钱侧错值」
 * （与 `CreditCell` 里「`null` 不能渲染成 `x0`」是同一条铁律的两个面）。
 *
 * ⇒ 比较器把 `null` 视为「不可比」，`null` 恒大于任何有值者；
 *    且**两个方向都把它们放末尾**（见 {@link compareCredits} 的 `desc` 分支）。
 *
 * ## 稳定性
 *
 * 用 `Array.prototype.sort`（ES2019 起规范保证稳定）配合「相等返回 0」，
 * 因此同倍率的行保持原有相对顺序，不会在每次点击间来回跳。
 */

/** 倍率列的排序方向。`null` = 不排序（保持上游原始顺序）。 */
export type CreditSortDirection = "asc" | "desc" | null;

/**
 * 三态循环：无 → 升 → 降 → 无。
 *
 * 抽成纯函数而非在组件里内联 `direction === "asc" ? "desc" : ...`，
 * 是为了让两张表**共用同一条**转移规则（也便于单测）。
 */
export function nextCreditSort(direction: CreditSortDirection): CreditSortDirection {
  if (direction === null) return "asc";
  if (direction === "asc") return "desc";
  return null;
}

/**
 * 倍率比较器：`null` 恒沉底（两个方向都是）。
 *
 * @param a 左侧模型的倍率（`null` = 上游未提供）
 * @param b 右侧模型的倍率
 * @param direction 排序方向，`null` 时恒返回 `0`（上方调用方据此跳过排序）
 */
export function compareCredits(
  a: number | null,
  b: number | null,
  direction: Exclude<CreditSortDirection, null>,
): number {
  // 两侧都无倍率 → 视作相等，保持原序。
  if (a === null && b === null) return 0;
  // 任一侧为 null → 沉底。注意**不乘方向系数**：`null` 在两个方向都排最后，
  // 否则降序时它们会全部翻到最前面，又变成一种「最划算」的错误暗示。
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

/**
 * 按倍率排序一份模型数组。
 *
 * - `direction === null` → **原样返回**（不复制、不排序），保持上游顺序。
 * - 否则复制后排序（不原地改传入数组 —— React 的 state / props 不应被改）。
 *
 * @param models 待排序的模型数组
 * @param getCredits 取倍率的访问器（两个产品的字段名不同：Trae 是 `credits: number | null`，
 *   WorkBuddy 是 `credits: string | null` 需要先解析）
 */
export function sortByCredits<T>(
  models: T[],
  getCredits: (model: T) => number | null,
  direction: CreditSortDirection,
): T[] {
  if (direction === null) return models;
  return [...models].sort((left, right) =>
    compareCredits(getCredits(left), getCredits(right), direction),
  );
}
