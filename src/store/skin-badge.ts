/**
 * 徽标配置类型 & 常量
 *
 * 徽标 = Sidebar footer 内的自定义品牌文字（Orbitron 字体）。
 * 拆自 store/skin.ts，避免主文件超 300 行。
 */

/** 徽标配置 */
export interface SkinBadgeConfig {
  /** 是否显示（默认关闭） */
  enabled: boolean;
  /** 主标题文字（空字符串 = 不渲染该行） */
  text: string;
  /** 副标题文字（空字符串 = 不渲染该行） */
  subtitle: string;
}

export const DEFAULT_BADGE: SkinBadgeConfig = {
  enabled: true,
  text: '4TORM',
  subtitle: 'AI AGENT SYSTEM',
};
