"use client";

import { DatabaseOutlined } from "@ant-design/icons";
import { Card, Empty, Flex, Progress, Space, Statistic, Table, Tag, Typography } from "antd";
import { useMemo } from "react";
import { useDashboardData } from "@/components/console/hooks/use-dashboard-data";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import { createDownloadColumns } from "@/components/console/download-columns";
import {
  progressForwardOriginText,
  progressPercent,
  progressPhaseText,
  progressSenderText,
  progressSourceText,
  progressTitle,
} from "@/components/console/utils";
import { formatByte } from "@/utils/format";

export function DashboardPage() {
  const columns = useMemo(() => createDownloadColumns(), []);
  const { downloads, stats, loading } = useDashboardData();
  const { status, queue, activeProgressItems } = useConsoleRuntime();
  const chatProgressItems = queue?.chatProgress ?? [];

  return (
    <>
      <section className="metric-grid">
        <Card className="metric-card">
          <Statistic title="运行任务" value={status?.runtime.activeTasks ?? 0} />
        </Card>
        <Card className="metric-card">
          <Statistic title="队列任务" value={status?.runtime.queuedTasks ?? 0} />
        </Card>
        <Card className="metric-card">
          <Statistic title="下载成功" value={stats?.success ?? 0} />
        </Card>
        <Card className="metric-card">
          <Statistic title="失败" value={stats?.failed ?? 0} styles={{ content: { color: "#d4380d" } }} />
        </Card>
        <Card className="metric-card">
          <Statistic title="已停止" value={stats?.stopped ?? 0} />
        </Card>
        <Card className="metric-card">
          <Statistic title="总流量" value={formatByte(stats?.totalBytes ?? 0)} />
        </Card>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-main-stack">
          <Card title="最近下载" className="dashboard-card recent-download-card">
            <Table
              rowKey="id"
              columns={columns}
              dataSource={downloads}
              pagination={false}
              loading={loading}
              size="small"
              scroll={{ x: 860 }}
            />
          </Card>
        </div>

        <aside className="dashboard-side-stack">
          <Card title="运行组件" className="dashboard-card">
            <Space orientation="vertical" size={12} className="status-stack">
              <section className="status-section">
                <Typography.Text strong>核心服务</Typography.Text>
                <div className="tag-grid">
                  <Tag color={status?.serverRuntime?.workerStarted ? "green" : "red"}>worker</Tag>
                  <Tag color={status?.serverRuntime?.listenForwardStarted ? "green" : "red"}>listen</Tag>
                  <Tag color={status?.botClient?.configured ? (status.botClient.started ? "green" : "red") : "default"}>
                    bot
                  </Tag>
                </div>
              </section>
              {status?.serverRuntime?.botError ? (
                <Typography.Text type="danger" ellipsis className="status-message">
                  Bot: {status.serverRuntime.botError}
                </Typography.Text>
              ) : null}
              {status?.serverRuntime?.workerError ? (
                <Typography.Text type="danger" ellipsis className="status-message">
                  Worker: {status.serverRuntime.workerError}
                </Typography.Text>
              ) : null}
              {status?.serverRuntime?.listenForwardError ? (
                <Typography.Text type="danger" ellipsis className="status-message">
                  Listen: {status.serverRuntime.listenForwardError}
                </Typography.Text>
              ) : null}
              {status?.userClient?.session?.warning ? (
                <Typography.Text type="warning" ellipsis className="status-message">
                  Session: {status.userClient.session.warning}
                </Typography.Text>
              ) : null}
            </Space>
          </Card>

          <Card title="配置扫描进度" className="dashboard-card">
            <Space orientation="vertical" size={16} className="status-stack">
              <section className="status-section">
                <Flex align="center" justify="space-between" gap={12} className="status-section-heading">
                  <Typography.Text strong>传输进度</Typography.Text>
                  <Tag>{activeProgressItems.length} active</Tag>
                </Flex>
                {activeProgressItems.length ? (
                  <Space orientation="vertical" size={12} className="status-stack">
                    {activeProgressItems.map((item) => (
                      <div key={item.jobId} className="progress-item">
                        <div className="progress-item-header">
                          <Typography.Text ellipsis className="progress-title">
                            {progressTitle(item)}
                          </Typography.Text>
                          <Typography.Text type="secondary" className="progress-speed">
                            {formatByte(item.speed ?? 0)}/s
                          </Typography.Text>
                        </div>
                        <div className="tag-grid progress-tags">
                          <Tag color={item.phase === "download" ? "blue" : "green"}>{progressPhaseText(item)}</Tag>
                          {item.messageId ? <Tag>msg {item.messageId}</Tag> : null}
                          {item.mediaType ? <Tag>{item.mediaType}</Tag> : null}
                          {item.mediaGroupId ? <Tag color="purple">group</Tag> : null}
                          <Tag color="blue">{progressSourceText(item)}</Tag>
                          {progressSenderText(item) ? <Tag>sender {progressSenderText(item)}</Tag> : null}
                          {progressForwardOriginText(item) ? (
                            <Tag color="cyan">
                              origin {progressForwardOriginText(item)}
                              {item.forwardMessageId ? ` #${item.forwardMessageId}` : ""}
                            </Tag>
                          ) : null}
                        </div>
                        <Progress
                          percent={progressPercent(item)}
                          size="small"
                          format={() =>
                            (item.total ?? 0) > 0
                              ? `${formatByte(item.downloaded ?? 0)} / ${formatByte(item.total ?? 0)}`
                              : formatByte(item.downloaded ?? 0)
                          }
                        />
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无传输任务" className="compact-empty" />
                )}
              </section>

              <section className="status-section">
                <Typography.Text strong>配置扫描记录</Typography.Text>
                {chatProgressItems.length ? (
                  <div className="chat-progress-list">
                    {chatProgressItems.map((item) => (
                      <div key={item.chatId} className="chat-progress-row">
                        <Typography.Text ellipsis className="chat-progress-title">
                          {item.chatTitle || item.chatId}
                        </Typography.Text>
                        <div className="tag-grid">
                          <Tag>last {item.lastReadMessageId}</Tag>
                          <Tag color="blue">queued {item.totalQueued}</Tag>
                          <Tag>skip {item.totalSkipped}</Tag>
                          {item.lastError ? <Tag color="red">error</Tag> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置扫描记录" className="compact-empty" />
                )}
              </section>

              <section className="status-section">
                <Typography.Text strong>任务队列</Typography.Text>
                <div className="tag-grid queue-status-grid">
                  <Tag color="blue">running {queue?.stats?.running ?? 0}</Tag>
                  <Tag color="gold">queued {queue?.stats?.queued ?? 0}</Tag>
                  <Tag>stopped {queue?.stats?.stopped ?? 0}</Tag>
                  <Tag icon={<DatabaseOutlined />}>sqlite</Tag>
                </div>
              </section>
            </Space>
          </Card>
        </aside>
      </section>
    </>
  );
}
