/**
 * 背景 canvas 冻结开关（模块级单例）
 *
 * 页面切换时，含 backdrop-filter 的面板要跑进场动画。若背景 canvas 同时在
 * 逐帧重绘，玻璃层需跟着背景每帧重采样，与面板自身动画叠加 = 卡顿。
 *
 * 切换期间调用 freezeBackground(ms) 把背景暂停一小段（默认覆盖进场时长），
 * 背景静止后玻璃层只因面板动画重算，成本大降、动画顺滑。Contour/Wind 的
 * animate 循环像检查 document.hidden 一样检查 isBgFrozen()。
 */

let frozenUntil = 0;
let now: () => number = () => 0; // 避免直接依赖 Date.now，由首次调用注入

export function freezeBackground(ms = 260): void {
  now = () => performance.now();
  frozenUntil = now() + ms;
}

export function isBgFrozen(): boolean {
  return frozenUntil > now();
}
