import type { ConsoleViewKey } from "@/types/console";

export const consolePages: Record<ConsoleViewKey, { title: string; subtitle: string; path: string }> = {
  dashboard: {
    title: "下载控制台",
    subtitle: "SQL 队列、配置扫描、下载记录和运行状态。",
    path: "/",
  },
  tasks: {
    title: "任务管理",
    subtitle: "查看任务、队列状态、下载明细并管理排队或运行中的任务。",
    path: "/tasks",
  },
  plugins: {
    title: "插件",
    subtitle: "内置下载插件状态。",
    path: "/plugins",
  },
  settings: {
    title: "配置",
    subtitle: "运行配置和 Telegram 客户端状态。",
    path: "/settings",
  },
};
