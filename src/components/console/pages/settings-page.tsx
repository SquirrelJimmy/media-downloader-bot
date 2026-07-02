"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, InputNumber, Select, Space, Switch, Tabs } from "antd";
import { useCallback, useEffect, useState } from "react";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";
import { useConfigData } from "@/components/console/hooks/use-config-data";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import { TelegramLoginModal } from "@/components/console/telegram-login-modal";
import type { TelegramLoginResponse } from "@/types/console";
import {
  cloudAdapterOptions,
  fileNamePrefixOptions,
  isSupportedCloudAdapter,
  languageOptions,
  mediaTypeOptions,
  pathPrefixOptions,
} from "@/components/console/utils";

export function SettingsPage() {
  const { message } = App.useApp();
  const { refreshRuntime } = useConsoleRuntime();
  const {
    config,
    settingsForm,
    configLoading,
    configSaving,
    loadConfig,
    saveRuntimeSettings,
    saveTelegramSettings,
  } = useConfigData({ formScope: "settings" });
  const [runtimeRestarting, setRuntimeRestarting] = useState(false);
  const [telegramLoginOpen, setTelegramLoginOpen] = useState(false);
  const cloudUploadEnabled = Boolean(Form.useWatch("cloudUploadEnabled", settingsForm));
  const cloudUploadAdapter = Form.useWatch("cloudUploadAdapter", settingsForm);
  const telegramForwardEnabled = Boolean(Form.useWatch("telegramForwardEnabled", settingsForm));
  const telegramPhone = Form.useWatch("telegramPhone", settingsForm);
  const cloudAdapterUnsupported = Boolean(cloudUploadAdapter && !isSupportedCloudAdapter(cloudUploadAdapter));

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const restartRuntimeServices = useCallback(async () => {
    setRuntimeRestarting(true);
    try {
      const result = await fetchJson<{ error?: string; message?: string }>("/api/runtime/restart", { method: "POST" });
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (!result.ok) {
        message.error(result.error ?? "重启相关服务失败");
        return;
      }
      message.success("服务已重启，运行组件状态已刷新");
      await Promise.all([refreshRuntime(), loadConfig()]);
    } finally {
      setRuntimeRestarting(false);
    }
  }, [loadConfig, message, refreshRuntime]);

  const saveTelegramBeforeLogin = useCallback(
    async (phone: string) => {
      settingsForm.setFieldValue("telegramPhone", phone);
      const saved = await saveTelegramSettings();
      return Boolean(saved);
    },
    [saveTelegramSettings, settingsForm],
  );

  const handleTelegramLoginCompleted = useCallback(
    async (result: TelegramLoginResponse) => {
      message.success(
        result.user?.displayName ? `Telegram 已登录：${result.user.displayName}` : "Telegram 登录完成",
      );
      await restartRuntimeServices();
    },
    [message, restartRuntimeServices],
  );

  const settingsActions = (
    <Space>
      <Button loading={runtimeRestarting} disabled={false} onClick={() => void restartRuntimeServices()}>
        重启相关服务
      </Button>
      <Button icon={<ReloadOutlined />} loading={configLoading} disabled={false} onClick={() => void loadConfig()}>
        重新加载
      </Button>
      <Button
        type="primary"
        loading={configSaving}
        disabled={!config || configLoading}
        onClick={() => void saveRuntimeSettings()}
      >
        保存配置
      </Button>
    </Space>
  );

  const telegramActions = (
    <Space>
      <Button disabled={!config || configLoading || configSaving} onClick={() => setTelegramLoginOpen(true)}>
        登录 Telegram
      </Button>
      <Button loading={runtimeRestarting} disabled={false} onClick={() => void restartRuntimeServices()}>
        重启相关服务
      </Button>
      <Button icon={<ReloadOutlined />} loading={configLoading} disabled={false} onClick={() => void loadConfig()}>
        重新加载
      </Button>
      <Button
        type="primary"
        loading={configSaving}
        disabled={!config || configLoading}
        onClick={() => void saveRuntimeSettings()}
      >
        保存配置
      </Button>
    </Space>
  );

  return (
    <>
      <Form component={false} form={settingsForm} layout="vertical" disabled={!config || configSaving}>
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Card title="Telegram 配置" extra={telegramActions} loading={configLoading && !config}>
            <section className="settings-grid">
              <Form.Item name="telegramApiId" label="api_id" rules={[{ required: true, message: "请输入 api_id" }]}>
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="telegramApiHash" label="api_hash">
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="telegramBotToken" label="bot_token">
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="telegramAllowedUserIds" label="allowed_user_ids">
                <Select mode="tags" tokenSeparators={[",", "\n", " "]} placeholder="输入用户 ID 或用户名" />
              </Form.Item>
              <Form.Item name="telegramSessionsDir" label="sessions_dir" rules={[{ required: true, message: "请输入 sessions_dir" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="telegramUserSession" label="user_session" rules={[{ required: true, message: "请输入 user_session" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="telegramPhone" label="phone">
                <Input placeholder="+86..." />
              </Form.Item>
            </section>
          </Card>

          <Card title="运行配置" extra={settingsActions} loading={configLoading && !config}>
            <Tabs
              items={[
                {
                  key: "base",
                  label: "基础",
                  children: (
                    <section className="settings-grid">
                      <Form.Item name="appName" label="应用名称" rules={[{ required: true, message: "请输入应用名称" }]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="language" label="语言" rules={[{ required: true, message: "请选择语言" }]}>
                        <Select options={languageOptions} />
                      </Form.Item>
                      <Form.Item name="savePath" label="下载目录" rules={[{ required: true, message: "请输入下载目录" }]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="tempPath" label="临时目录" rules={[{ required: true, message: "请输入临时目录" }]}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="dateFormat" label="日期格式">
                        <Input />
                      </Form.Item>
                      <Form.Item name="fileNamePrefixSplit" label="文件名前缀分隔符">
                        <Input />
                      </Form.Item>
                    </section>
                  ),
                },
                {
                  key: "download",
                  label: "下载",
                  children: (
                    <section className="settings-grid">
                      <Form.Item name="mediaTypes" label="媒体类型">
                        <Select mode="tags" options={mediaTypeOptions} />
                      </Form.Item>
                      <Form.Item name="filePathPrefix" label="目录前缀">
                        <Select mode="tags" options={pathPrefixOptions} />
                      </Form.Item>
                      <Form.Item name="fileNamePrefix" label="文件名前缀">
                        <Select mode="tags" options={fileNamePrefixOptions} />
                      </Form.Item>
                      <Form.Item name="botDownloadFilter" label="Bot 默认过滤器">
                        <Select mode="tags" tokenSeparators={["\n"]} />
                      </Form.Item>
                      <Form.Item name="hideFileName" label="隐藏文件名" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item name="dropNoAudioVideo" label="丢弃无声音视频" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </section>
                  ),
                },
                {
                  key: "queue",
                  label: "队列",
                  children: (
                    <section className="settings-grid">
                      <Form.Item name="maxDownloadTasks" label="最大下载任务" rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item name="maxConcurrentTransmissions" label="最大并发传输" rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </section>
                  ),
                },
                {
                  key: "cloud-upload",
                  label: "云盘上传",
                  children: (
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                      <Alert
                        showIcon
                        type="info"
                        message="当前云盘上传通过 rclone 执行"
                        description="请先在运行环境中完成 rclone config，并在远端目录中填写类似 drive:/telegram 的目标路径。系统只执行上传，不负责创建 rclone remote。"
                      />
                      {cloudAdapterUnsupported ? (
                        <Alert
                          showIcon
                          type="warning"
                          message="当前云盘适配器后端未注册"
                          description="aligo、webdav、none 目前仅保留配置兼容；启用云盘上传时请选择 rclone，否则保存会被拦截。"
                        />
                      ) : null}
                      <section className="settings-grid">
                        <Form.Item name="cloudUploadEnabled" label="启用云盘上传" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Form.Item
                          name="cloudUploadAdapter"
                          label="云盘适配器"
                          rules={[
                            {
                              validator: async (_, value) => {
                                if (cloudUploadEnabled && !isSupportedCloudAdapter(value)) {
                                  throw new Error("当前后端未注册该云盘适配器，启用云盘上传时请选择 rclone");
                                }
                              },
                            },
                          ]}
                        >
                          <Select disabled={!cloudUploadEnabled} options={cloudAdapterOptions} />
                        </Form.Item>
                        <Form.Item
                          name="cloudRemoteDir"
                          label="云盘远端目录"
                          rules={
                            cloudUploadEnabled && cloudUploadAdapter === "rclone"
                              ? [{ required: true, whitespace: true, message: "请输入云盘远端目录" }]
                              : []
                          }
                        >
                          <Input disabled={!cloudUploadEnabled || cloudUploadAdapter !== "rclone"} placeholder="drive:/telegram" />
                        </Form.Item>
                        <Form.Item
                          name="rclonePath"
                          label="rclone 路径"
                          rules={
                            cloudUploadEnabled && cloudUploadAdapter === "rclone"
                              ? [{ required: true, whitespace: true, message: "请输入 rclone 路径" }]
                              : []
                          }
                        >
                          <Input disabled={!cloudUploadEnabled || cloudUploadAdapter !== "rclone"} placeholder="rclone" />
                        </Form.Item>
                        <Form.Item name="beforeUploadFileZip" label="上传前压缩" valuePropName="checked">
                          <Switch disabled={!cloudUploadEnabled || cloudUploadAdapter !== "rclone"} />
                        </Form.Item>
                        <Form.Item
                          name="cloudDeleteAfterUpload"
                          label="云盘上传成功后删除本地文件"
                          valuePropName="checked"
                          help="仅在云盘上传成功后删除本地文件。"
                        >
                          <Switch disabled={!cloudUploadEnabled || cloudUploadAdapter !== "rclone"} />
                        </Form.Item>
                      </section>
                    </Space>
                  ),
                },
                {
                  key: "telegram-forward",
                  label: "Telegram 转发",
                  children: (
                    <section className="settings-grid">
                      <Form.Item name="telegramForwardEnabled" label="启用 Telegram 转发" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        name="telegramForwardTargetChatId"
                        label="Telegram 转发目标"
                        rules={
                          telegramForwardEnabled
                            ? [{ required: true, whitespace: true, message: "请输入 Telegram 转发目标" }]
                            : []
                        }
                      >
                        <Input disabled={!telegramForwardEnabled} />
                      </Form.Item>
                      <Form.Item name="forwardLimitPerMinute" label="转发每分钟限制">
                        <InputNumber disabled={!telegramForwardEnabled} min={0} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item
                        name="forwardDeleteAfterUpload"
                        label="转发后删除本地文件"
                        valuePropName="checked"
                        help="仅在 Telegram 转发成功后删除本地文件。"
                      >
                        <Switch disabled={!telegramForwardEnabled} />
                      </Form.Item>
                    </section>
                  ),
                },
                {
                  key: "pipeline",
                  label: "管线",
                  children: (
                    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                      <Alert
                        showIcon
                        type="info"
                        message="管线策略影响下载完成后的后处理"
                        description="此处的删除策略用于 Telegram 转发成功后的通用清理；云盘上传成功后的删除请在“云盘上传”Tab 单独配置。"
                      />
                      <section className="settings-grid">
                        <Form.Item
                          name="pipelineDeleteAfterUpload"
                          label="管线成功后删除本地文件"
                          valuePropName="checked"
                          help="当前仅在 Telegram 转发成功时参与删除判断；云盘上传使用独立开关。"
                        >
                          <Switch />
                        </Form.Item>
                      </section>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      </Form>
      <TelegramLoginModal
        open={telegramLoginOpen}
        initialPhone={typeof telegramPhone === "string" ? telegramPhone : ""}
        onClose={() => setTelegramLoginOpen(false)}
        onBeforeStart={saveTelegramBeforeLogin}
        onCompleted={handleTelegramLoginCompleted}
      />
    </>
  );
}
