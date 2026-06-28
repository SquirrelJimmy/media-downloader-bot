"use client";

import { CloudUploadOutlined, LogoutOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Flex, Space, Typography } from "antd";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { fetchJson } from "@/components/console/http";
import { consolePages } from "@/components/console/page-meta";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import type { ConsoleViewKey } from "@/types/console";

function pageKeyFromPathname(pathname: string): ConsoleViewKey {
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

export function ConsoleHeader() {
  const { message } = App.useApp();
  const router = useRouter();
  const { loading, refreshRuntime, retryFailed, runConfiguredScan } = useConsoleRuntime();
  const pathname = usePathname();
  const page = consolePages[pageKeyFromPathname(pathname)];

  const logout = async () => {
    const result = await fetchJson("/api/auth/logout", { method: "POST" });
    if (!result.ok) {
      message.error(result.error ?? "退出登录失败");
      return;
    }
    router.replace("/login" as Route);
  };

  return (
    <header className="console-header">
      <Flex align="center" justify="space-between" gap={16} className="console-header-inner">
        <div className="console-header-title-block">
          <Typography.Text strong className="console-header-title">
            {page.title}
          </Typography.Text>
          <Typography.Text type="secondary" className="console-header-subtitle">
            {page.subtitle}
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshRuntime()} />
          <Button icon={<CloudUploadOutlined />} onClick={() => void retryFailed()}>
            重试失败
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void runConfiguredScan()}>
            运行配置扫描
          </Button>
          <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
            退出
          </Button>
        </Space>
      </Flex>
    </header>
  );
}
