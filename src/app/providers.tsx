"use client";

import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 8,
          colorPrimary: "#1677ff",
          colorSuccess: "#2f9e44",
          colorWarning: "#d97706",
          colorError: "#d4380d",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: "#f5f7fb",
            headerBg: "#ffffff",
            siderBg: "#101828",
            triggerBg: "#101828",
          },
          Card: {
            borderRadiusLG: 8,
          },
          Table: {
            headerBg: "#f8fafc",
          },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
