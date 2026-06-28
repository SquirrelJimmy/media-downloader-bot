"use client";

import { InfoCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Drawer, Form, Input, InputNumber, Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useConfigData } from "@/components/console/hooks/use-config-data";
import { useYtdlpStatus } from "@/components/console/hooks/use-ytdlp-status";
import type { PluginFormValues } from "@/types/console";

type PluginKey = "telegramText" | "http" | "ytdlp" | "telegram";

type PluginRow = {
  key: PluginKey;
  name: string;
  priority: number;
  priorityField?: keyof PluginFormValues;
  enabledField: keyof PluginFormValues;
  hasDetail?: boolean;
  hasUpdate?: boolean;
};

const builtinPluginRows: PluginRow[] = [
  {
    key: "telegram",
    name: "Telegram 媒体",
    priority: 1,
    enabledField: "telegramEnabled",
  },
  {
    key: "ytdlp",
    name: "yt-dlp",
    priority: 1.5,
    priorityField: "ytdlpPriority",
    enabledField: "ytdlpEnabled",
    hasDetail: true,
    hasUpdate: true,
  },
  {
    key: "http",
    name: "HTTP 直链",
    priority: 1.75,
    priorityField: "httpPriority",
    enabledField: "httpEnabled",
    hasDetail: true,
  },
  {
    key: "telegramText",
    name: "文本消息",
    priority: 2,
    priorityField: "telegramTextPriority",
    enabledField: "telegramTextEnabled",
  },
];

const ytdlpFormatOptions = [
  { label: "最高质量", value: "bestvideo*+bestaudio/best" },
  { label: "最高单文件", value: "best" },
  { label: "MP4 优先", value: "bestvideo*[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" },
  { label: "仅音频", value: "bestaudio/best" },
];

export function PluginsPage() {
  const {
    config,
    pluginForm,
    configLoading,
    configSaving,
    loadConfig,
    savePluginSettings,
  } = useConfigData({ formScope: "plugins" });
  const {
    ytdlpStatus,
    ytdlpStatusLoading,
    ytdlpDownloading,
    loadYtdlpStatus,
    downloadYtdlp,
  } = useYtdlpStatus({ pluginForm, loadConfig });
  const [detailPlugin, setDetailPlugin] = useState<PluginKey | null>(null);
  const ytdlpPriority = Form.useWatch("ytdlpPriority", pluginForm);
  const httpPriority = Form.useWatch("httpPriority", pluginForm);
  const telegramTextPriority = Form.useWatch("telegramTextPriority", pluginForm);

  useEffect(() => {
    void loadConfig();
    void loadYtdlpStatus();
  }, [loadConfig, loadYtdlpStatus]);

  const pluginRows = useMemo(
    () =>
      builtinPluginRows
        .map((row) => {
          const configuredPriority =
            row.key === "ytdlp"
              ? ytdlpPriority
              : row.key === "http"
                ? httpPriority
                : row.key === "telegramText"
                  ? telegramTextPriority
                  : undefined;
          return {
            ...row,
            priority:
              typeof configuredPriority === "number" && Number.isFinite(configuredPriority) && configuredPriority > 0
                ? configuredPriority
                : row.priority,
          };
        })
        .sort((a, b) => a.priority - b.priority),
    [httpPriority, telegramTextPriority, ytdlpPriority],
  );

  const pluginActions = (
    <Space>
      <Button icon={<ReloadOutlined />} loading={configLoading} onClick={() => void loadConfig()}>
        重新加载
      </Button>
      <Button
        type="primary"
        loading={configSaving}
        disabled={!config || configLoading}
        onClick={() => void savePluginSettings()}
      >
        保存插件设置
      </Button>
    </Space>
  );

  const pluginColumns: ColumnsType<PluginRow> = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        render: (_value, row) => (
          <Space orientation="vertical" size={2}>
            <Typography.Text strong>{row.name}</Typography.Text>
            <Typography.Text type="secondary" className="plugin-priority-text">
              优先级 {row.priority.toFixed(2)}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "开关",
        key: "enabled",
        width: 120,
        render: (_value, row) => (
          <Form.Item
            noStyle
            shouldUpdate={(prev: PluginFormValues, next: PluginFormValues) =>
              prev[row.enabledField] !== next[row.enabledField]
            }
          >
            {({ getFieldValue, setFieldValue }) => (
              <Switch
                checked={Boolean(getFieldValue(row.enabledField))}
                disabled={!config || configSaving}
                onChange={(checked) => setFieldValue(row.enabledField, checked)}
              />
            )}
          </Form.Item>
        ),
      },
      {
        title: "优先级",
        key: "priority",
        width: 150,
        render: (_value, row) =>
          row.priorityField ? (
            <Form.Item
              noStyle
              name={row.priorityField}
              rules={[{ required: true, type: "number", min: 0.1, message: "请输入大于 0 的优先级" }]}
            >
              <InputNumber min={0.1} step={0.05} precision={2} style={{ width: 108 }} disabled={!config || configSaving} />
            </Form.Item>
          ) : (
            <Tag color="blue">{row.priority.toFixed(2)}</Tag>
          ),
      },
      {
        title: "操作",
        key: "actions",
        width: 320,
        render: (_value, row) => (
          <Space size={8} wrap>
            {row.key === "ytdlp" && row.hasUpdate ? (
              <Button size="small" loading={ytdlpDownloading} onClick={() => void downloadYtdlp()}>
                {ytdlpStatus?.exists ? "更新" : "下载"}
              </Button>
            ) : null}
            {row.hasDetail ? (
              <Button size="small" icon={<InfoCircleOutlined />} onClick={() => setDetailPlugin(row.key)}>
                详情
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    [
      config,
      configSaving,
      downloadYtdlp,
      ytdlpDownloading,
      ytdlpStatus?.exists,
    ],
  );

  const detailTitle = detailPlugin ? pluginRows.find((row) => row.key === detailPlugin)?.name : undefined;

  const ytdlpStatusTag = (
    <Space size={8} wrap>
      <Tag color={ytdlpStatus?.executable ? "green" : ytdlpStatus?.exists ? "gold" : "red"}>
        {ytdlpStatus?.executable ? "可执行" : ytdlpStatus?.exists ? "不可执行" : "未安装"}
      </Tag>
      <Tag>{ytdlpStatus?.assetName ?? "auto asset"}</Tag>
      {ytdlpStatus?.version ? <Tag color="blue">{ytdlpStatus.version}</Tag> : null}
    </Space>
  );

  return (
    <>
      <Card title="插件设置" extra={pluginActions} loading={configLoading && !config}>
        <Form component={false} form={pluginForm} layout="vertical" disabled={!config || configSaving}>
          <div className="settings-note">
            <Typography.Text type="secondary">
              插件按实际匹配优先级从高到低展示；数值越小越优先。Telegram 媒体固定优先级，其它插件可调整后保存。
            </Typography.Text>
            <Space size={8} wrap>
              {pluginRows.map((row) => (
                <Tag key={row.key}>{`${row.priority.toFixed(2)} ${row.name}`}</Tag>
              ))}
            </Space>
          </div>
          <Table
            className="plugin-table"
            columns={pluginColumns}
            dataSource={pluginRows}
            pagination={false}
            rowKey="key"
            size="middle"
            scroll={{ x: 820 }}
          />
          <Drawer
            title={detailTitle ? `${detailTitle} 详情` : "插件详情"}
            open={Boolean(detailPlugin)}
            onClose={() => setDetailPlugin(null)}
            size="50vw"
            rootClassName="plugin-detail-drawer"
            destroyOnHidden
            extra={
              <Button
                type="primary"
                loading={configSaving}
                disabled={!config || configLoading}
                onClick={() => void savePluginSettings()}
              >
                保存插件设置
              </Button>
            }
          >
            {detailPlugin === "ytdlp" ? (
              <Space orientation="vertical" size="large" style={{ width: "100%" }}>
                <section className="settings-section">
                  <Typography.Text strong className="settings-section-title">
                    状态
                  </Typography.Text>
                  {ytdlpStatusTag}
                  <Typography.Text type="secondary" ellipsis>
                    {ytdlpStatus?.path ?? "尚未检测本机 yt-dlp 状态"}
                  </Typography.Text>
                  <Space size={8} wrap>
                    <Button size="small" loading={ytdlpStatusLoading} onClick={() => void loadYtdlpStatus()}>
                      检测
                    </Button>
                    <Button size="small" loading={ytdlpStatusLoading} onClick={() => void loadYtdlpStatus({ includeVersion: true })}>
                      检测版本
                    </Button>
                    <Button size="small" loading={ytdlpDownloading} onClick={() => void downloadYtdlp()}>
                      {ytdlpStatus?.exists ? "更新" : "下载"}
                    </Button>
                  </Space>
                </section>
                <section className="settings-section">
                  <Typography.Text strong className="settings-section-title">
                    基础配置
                  </Typography.Text>
                  <Form.Item name="ytdlpEnabled" label="启用 yt-dlp" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="ytdlpPath" label="yt-dlp 路径" rules={[{ required: true, message: "请输入 yt-dlp 路径" }]}>
                    <Input placeholder="./data/bin/yt-dlp_macos" />
                  </Form.Item>
                </section>
                <section className="settings-section">
                  <Typography.Text strong className="settings-section-title">
                    下载参数
                  </Typography.Text>
                  <section className="settings-grid">
                    <Form.Item name="ytdlpFormat" label="格式选择" rules={[{ required: true, message: "请输入格式选择参数" }]}>
                      <Input list="ytdlp-format-options" placeholder="bestvideo*+bestaudio/best" />
                    </Form.Item>
                    <datalist id="ytdlp-format-options">
                      {ytdlpFormatOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </datalist>
                    <Form.Item name="ytdlpNoPlaylist" label="禁用 playlist" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="ytdlpMergeOutputFormat" label="合并输出格式">
                      <Input placeholder="mp4" />
                    </Form.Item>
                    <Form.Item name="ytdlpProxy" label="代理">
                      <Input placeholder="socks5://127.0.0.1:7890" />
                    </Form.Item>
                    <Form.Item name="ytdlpCookies" label="Cookies 文件">
                      <Input placeholder="/path/to/cookies.txt" />
                    </Form.Item>
                    <Form.Item name="ytdlpCookiesFromBrowser" label="浏览器 Cookies">
                      <Input placeholder="chrome" />
                    </Form.Item>
                    <Form.Item name="ytdlpUserAgent" label="User-Agent">
                      <Input />
                    </Form.Item>
                    <Form.Item name="ytdlpReferer" label="Referer">
                      <Input />
                    </Form.Item>
                    <Form.Item name="ytdlpRateLimit" label="限速">
                      <Input placeholder="2M" />
                    </Form.Item>
                    <Form.Item name="ytdlpRetries" label="重试次数">
                      <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="ytdlpFragmentRetries" label="分片重试">
                      <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="ytdlpConcurrentFragments" label="并发分片">
                      <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </section>
                </section>
                <section className="settings-section">
                  <Typography.Text strong className="settings-section-title">
                    高级参数
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    每行一个参数或一组 --flag value，支持引号；输出路径、进度和执行钩子相关参数会被后端拒绝。
                  </Typography.Text>
                  <Form.Item name="ytdlpExtraArgs" label="extra_args">
                    <Input.TextArea
                      rows={6}
                      placeholder={'--embed-thumbnail\n--cookies-from-browser "chrome:$HOME/Library/Application Support/Google/Chrome/Default"'}
                    />
                  </Form.Item>
                </section>
              </Space>
            ) : null}
            {detailPlugin === "http" ? (
              <section className="settings-section">
                <Typography.Text strong className="settings-section-title">
                  配置
                </Typography.Text>
                <Form.Item name="httpEnabled" label="启用 HTTP 直链下载" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item
                  name="httpMaxFileSize"
                  label="最大文件大小（字节）"
                  rules={[{ required: true, message: "请输入最大文件大小" }]}
                >
                  <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              </section>
            ) : null}
          </Drawer>
        </Form>
      </Card>
    </>
  );
}
