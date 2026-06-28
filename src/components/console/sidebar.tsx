"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ControlOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Menu } from "antd";

function selectedKey(pathname: string) {
  if (pathname.startsWith("/downloads")) {
    return "tasks";
  }
  if (pathname.startsWith("/tasks")) {
    return "tasks";
  }
  if (pathname.startsWith("/files")) {
    return "tasks";
  }
  if (pathname.startsWith("/plugins")) {
    return "plugins";
  }
  if (pathname.startsWith("/settings")) {
    return "settings";
  }
  return "dashboard";
}

export function ConsoleSidebar() {
  const pathname = usePathname();
  return (
    <aside className="console-sider">
      <div className="console-sider-inner">
        <div className="console-sider-logo">媒体下载器</div>
        <Menu
          className="console-sider-menu"
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey(pathname)]}
          items={[
            { key: "dashboard", icon: <ControlOutlined />, label: <Link href="/">仪表盘</Link> },
            { key: "tasks", icon: <PlayCircleOutlined />, label: <Link href="/tasks">任务管理</Link> },
            { key: "plugins", icon: <RobotOutlined />, label: <Link href="/plugins">插件</Link> },
            { key: "settings", icon: <SettingOutlined />, label: <Link href="/settings">配置</Link> },
          ]}
        />
      </div>
    </aside>
  );
}
