"use client";

import { LockOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Typography } from "antd";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/components/console/http";

type LoginFormValues = {
  password: string;
};

function safeNextPath(value: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

export function LoginForm({ nextPath, reason }: { nextPath: string; reason?: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authConfigured, setAuthConfigured] = useState(true);
  const destination = useMemo(() => safeNextPath(nextPath), [nextPath]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ authenticated?: boolean; configured?: boolean }>("/api/auth/session")
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.data) {
          return;
        }
        const session = result.data;
        setAuthConfigured(Boolean(session.configured));
        if (session.authenticated) {
          router.replace(destination as Route);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setSessionLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [destination, router]);

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const result = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!result.ok) {
        message.error(result.error ?? "登录失败");
        return;
      }
      router.replace(destination as Route);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <Card className="login-card">
        <Typography.Title level={3} className="login-title">
          文件中转下载器
        </Typography.Title>
        <Typography.Text type="secondary" className="login-subtitle">
          输入控制台密码继续
        </Typography.Text>
        {reason === "not_configured" || !authConfigured ? (
          <Alert
            showIcon
            type="warning"
            message="控制台密码未配置"
            description="请设置环境变量 CONSOLE_PASSWORD 后重启服务。"
            className="login-alert"
          />
        ) : null}
        <Form layout="vertical" onFinish={onFinish} disabled={sessionLoading || !authConfigured}>
          <Form.Item name="password" label="控制台密码" rules={[{ required: true, message: "请输入控制台密码" }]}>
            <Input.Password prefix={<LockOutlined />} autoFocus autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}
