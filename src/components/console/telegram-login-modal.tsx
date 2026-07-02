"use client";

import { App, Alert, Button, Form, Input, Modal, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";
import type { TelegramLoginResponse } from "@/types/console";

type TelegramLoginStep = "phone" | "code" | "password" | "completed";

type TelegramLoginModalProps = {
  open: boolean;
  initialPhone?: string;
  onClose: () => void;
  onBeforeStart: (phone: string) => Promise<boolean>;
  onCompleted: (result: TelegramLoginResponse) => Promise<void>;
};

type TelegramLoginFormValues = {
  phone: string;
  code: string;
  password: string;
};

export function TelegramLoginModal({
  open,
  initialPhone,
  onClose,
  onBeforeStart,
  onCompleted,
}: TelegramLoginModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TelegramLoginFormValues>();
  const [step, setStep] = useState<TelegramLoginStep>("phone");
  const [loginId, setLoginId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loginMeta, setLoginMeta] = useState<TelegramLoginResponse | null>(null);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ phone: initialPhone ?? "", code: "", password: "" });
    }
  }, [form, initialPhone, open]);

  const title = useMemo(() => {
    if (step === "code") {
      return "输入 Telegram 验证码";
    }
    if (step === "password") {
      return "输入二步验证密码";
    }
    if (step === "completed") {
      return "Telegram 登录完成";
    }
    return "登录 Telegram";
  }, [step]);

  const postLogin = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      const result = await fetchJson<TelegramLoginResponse>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (redirectToLoginForAuthError(result)) {
        return null;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Telegram 登录失败");
        return null;
      }
      return result.data;
    },
    [message],
  );

  const completeLogin = useCallback(
    async (result: TelegramLoginResponse) => {
      setStep("completed");
      setLoginId(undefined);
      setLoginMeta(result);
      await onCompleted(result);
    },
    [onCompleted],
  );

  const startLogin = useCallback(async () => {
    const values = await form.validateFields(["phone"]);
    const phone = values.phone.trim();
    if (!(await onBeforeStart(phone))) {
      return;
    }
    const result = await postLogin("/api/telegram/login/start", { phone });
    if (!result) {
      return;
    }
    if (result.state === "completed") {
      await completeLogin(result);
      return;
    }
    setLoginId(result.loginId);
    setLoginMeta(result);
    setStep("code");
    form.setFieldsValue({ code: "" });
  }, [completeLogin, form, onBeforeStart, postLogin]);

  const verifyCode = useCallback(async () => {
    const values = await form.validateFields(["code"]);
    const result = await postLogin("/api/telegram/login/verify", {
      loginId,
      code: values.code.trim(),
    });
    if (!result) {
      return;
    }
    if (result.state === "password_required") {
      setLoginMeta(result);
      setStep("password");
      form.setFieldsValue({ password: "" });
      return;
    }
    await completeLogin(result);
  }, [completeLogin, form, loginId, postLogin]);

  const verifyPassword = useCallback(async () => {
    const values = await form.validateFields(["password"]);
    const result = await postLogin("/api/telegram/login/password", {
      loginId,
      password: values.password,
    });
    if (result) {
      await completeLogin(result);
    }
  }, [completeLogin, form, loginId, postLogin]);

  const cancelLogin = useCallback(async () => {
    const currentLoginId = loginId;
    setLoginId(undefined);
    setLoginMeta(null);
    setStep("phone");
    onClose();
    if (currentLoginId) {
      await postLogin("/api/telegram/login/cancel", { loginId: currentLoginId });
    }
  }, [loginId, onClose, postLogin]);

  const submit = useCallback(async () => {
    setLoading(true);
    try {
      if (step === "phone") {
        await startLogin();
      } else if (step === "code") {
        await verifyCode();
      } else if (step === "password") {
        await verifyPassword();
      } else {
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }, [onClose, startLogin, step, verifyCode, verifyPassword]);

  const primaryText = step === "phone" ? "发送验证码" : step === "code" ? "验证验证码" : step === "password" ? "完成登录" : "关闭";

  return (
    <Modal
      open={open}
      forceRender
      title={title}
      onCancel={() => void cancelLogin()}
      footer={[
        <Button key="cancel" disabled={loading} onClick={() => void cancelLogin()}>
          {step === "completed" ? "关闭" : "取消"}
        </Button>,
        step === "completed" ? null : (
          <Button key="submit" type="primary" loading={loading} onClick={() => void submit()}>
            {primaryText}
          </Button>
        ),
      ]}
    >
      <Form form={form} layout="vertical" disabled={loading}>
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          {step === "phone" ? (
            <Alert
              showIcon
              type="info"
              message="登录会使用当前已保存的 api_id、api_hash 和 session 路径"
              description="发送验证码前会先保存 Telegram 配置；登录成功后 session 会写入配置中的 user_session 文件。"
            />
          ) : null}

          {step === "phone" ? (
            <Form.Item name="phone" label="手机号" rules={[{ required: true, whitespace: true, message: "请输入 Telegram 手机号" }]}>
              <Input placeholder="+86..." autoComplete="tel" />
            </Form.Item>
          ) : null}

          {step === "code" ? (
            <>
              <Typography.Paragraph type="secondary">
                验证码已发送到 {loginMeta?.phone ?? "当前手机号"}
                {loginMeta?.codeType ? `，类型 ${loginMeta.codeType}` : ""}
                {loginMeta?.codeLength ? `，长度 ${loginMeta.codeLength} 位` : ""}。
              </Typography.Paragraph>
              <Form.Item name="code" label="验证码" rules={[{ required: true, whitespace: true, message: "请输入验证码" }]}>
                <Input autoComplete="one-time-code" />
              </Form.Item>
            </>
          ) : null}

          {step === "password" ? (
            <>
              <Alert
                showIcon
                type="warning"
                message="当前账号启用了二步验证"
                description={loginMeta?.passwordHint ? `密码提示：${loginMeta.passwordHint}` : "请输入 Telegram 二步验证密码。"}
              />
              <Form.Item name="password" label="二步验证密码" rules={[{ required: true, whitespace: true, message: "请输入二步验证密码" }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
            </>
          ) : null}

          {step === "completed" ? (
            <Alert
              showIcon
              type="success"
              message="Telegram 用户会话已保存"
              description={loginMeta?.sessionPath ? `Session 文件：${loginMeta.sessionPath}` : "服务会重新加载最新配置和 session。"}
            />
          ) : null}
        </Space>
      </Form>
    </Modal>
  );
}
