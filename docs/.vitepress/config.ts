import { defineConfig } from 'vitepress'

// 4torm 文档站配置
export default defineConfig({
  title: '4torm',
  description: '多 Agent 协作框架 —— 让 AI 像公司员工一样长期存在，按需协作',
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'A multi-agent collaboration framework for persistent AI teams',
      themeConfig: {
        nav: [
          { text: 'Start', link: '/en/guide/introduction' },
          {
            text: 'Workspaces',
            items: [
              { text: 'Monsoon · Chat', link: '/en/modes/chat' },
              { text: 'Convection · Meeting Rooms', link: '/en/modes/convection' },
              { text: 'Cyclone · Workshops', link: '/en/modes/cyclone' },
              { text: 'Tradewind · Workflows', link: '/en/modes/tradewind' },
              { text: 'Tide · Automation', link: '/en/modes/tide' },
            ],
          },
          { text: 'Extensions', link: '/en/extend/tools' },
          { text: 'Architecture', link: '/en/architecture/overview' },
          { text: 'GitHub', link: 'https://github.com/ccde141/4torm' },
        ],
        sidebar: {
          '/en/guide/': [
            {
              text: 'Start',
              items: [
                { text: 'Introduction', link: '/en/guide/introduction' },
                { text: 'Quick Start', link: '/en/guide/getting-started' },
                { text: 'Model Providers', link: '/en/guide/providers' },
                { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
                { text: 'Console and Agents', link: '/en/guide/agents' },
                { text: 'Core Concepts', link: '/en/guide/concepts' },
              ],
            },
          ],
          '/en/modes/': [
            {
              text: 'Collaboration Workspaces',
              items: [
                { text: 'Monsoon · Chat', link: '/en/modes/chat' },
                { text: 'Convection · Meeting Rooms', link: '/en/modes/convection' },
                { text: 'Cyclone · Workshops', link: '/en/modes/cyclone' },
                { text: 'Tradewind · Workflows', link: '/en/modes/tradewind' },
                { text: 'Tide · Automation', link: '/en/modes/tide' },
              ],
            },
          ],
          '/en/extend/': [
            {
              text: 'Extensions',
              items: [
                { text: 'Creating Tools', link: '/en/extend/tools' },
                { text: 'Creating Skills', link: '/en/extend/skills' },
                { text: 'MCP Integration', link: '/en/extend/mcp' },
              ],
            },
          ],
          '/en/architecture/': [
            {
              text: 'Architecture',
              items: [
                { text: 'Overview', link: '/en/architecture/overview' },
                { text: 'Data Layout', link: '/en/architecture/data-layout' },
                { text: 'Security and Isolation', link: '/en/architecture/security' },
                { text: 'Desktop · Electron', link: '/en/architecture/desktop' },
              ],
            },
          ],
        },
        outline: { level: [2, 3], label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        lastUpdatedText: 'Last updated',
        footer: {
          message: 'Released under the MIT License',
          copyright: 'Copyright © 2026 Ccde141',
        },
      },
    },
  },
  // 由 Fastify 自托管在 /docs/ 路径下(应用内「文档」按钮 → /docs/)
  base: '/docs/',
  lastUpdated: true,
  // 用 .html 链接:纯 @fastify/static 无法重写无扩展名 URL,带 .html 才能在硬刷新/深链时解析
  cleanUrls: false,

  // 内部任务书不发布
  srcExclude: ['_internal/**'],

  head: [
    // base 不会自动补进 head，需显式带上 /docs/，否则集成态走根级、docs:dev 独立态 404
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: '开始', link: '/guide/introduction' },
      {
        text: '五种模式',
        items: [
          { text: '季风 · 对话', link: '/modes/chat' },
          { text: '对流 · 会议室', link: '/modes/convection' },
          { text: '气旋 · 工作室', link: '/modes/cyclone' },
          { text: '信风 · 工作流', link: '/modes/tradewind' },
          { text: '潮汐 · 自动化任务', link: '/modes/tide' },
        ],
      },
      { text: '扩展开发', link: '/extend/tools' },
      { text: '架构', link: '/architecture/overview' },
      { text: 'GitHub', link: 'https://github.com/ccde141/4torm' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '介绍', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '模型提供商', link: '/guide/providers' },
            { text: '故障检修', link: '/guide/troubleshooting' },
            { text: '控制台与 Agent 管理', link: '/guide/agents' },
            { text: '核心概念', link: '/guide/concepts' },
          ],
        },
      ],
      '/modes/': [
        {
          text: '五种协作模式',
          items: [
            { text: '季风 · 对话', link: '/modes/chat' },
            { text: '对流 · 会议室', link: '/modes/convection' },
            { text: '气旋 · 工作室', link: '/modes/cyclone' },
            { text: '信风 · 工作流', link: '/modes/tradewind' },
            { text: '潮汐 · 自动化任务', link: '/modes/tide' },
          ],
        },
      ],
      '/extend/': [
        {
          text: '扩展开发',
          items: [
            { text: '工具制作', link: '/extend/tools' },
            { text: '技能制作', link: '/extend/skills' },
            { text: 'MCP 接入', link: '/extend/mcp' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '架构',
          items: [
            { text: '总体架构', link: '/architecture/overview' },
            { text: '数据目录', link: '/architecture/data-layout' },
            { text: '安全与隔离', link: '/architecture/security' },
            { text: '桌面化 · Electron', link: '/architecture/desktop' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ccde141/4torm' },
    ],

    outline: { level: [2, 3], label: '本页目录' },

    docFooter: { prev: '上一篇', next: '下一篇' },

    lastUpdatedText: '最后更新',

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2026 Ccde141',
    },
  },
})
