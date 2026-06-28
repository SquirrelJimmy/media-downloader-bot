"use client";

import { ExportOutlined } from "@ant-design/icons";
import { Button, Progress, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DownloadRecord } from "@/types/console";
import { formatByte } from "@/utils/format";
import { forwardOriginText, senderText, sourceText, statusColors, statusLabels } from "@/components/console/utils";

export function createDownloadColumns(): ColumnsType<DownloadRecord> {
  return [
    {
      title: "文件",
      dataIndex: "fileName",
      key: "fileName",
      ellipsis: true,
    },
    {
      title: "来源",
      key: "chat",
      width: 240,
      render: (_, record) => {
        const sender = senderText(record);
        const forwardOrigin = forwardOriginText(record);
        return (
          <Space orientation="vertical" size={0} style={{ maxWidth: 220 }}>
            <Typography.Text ellipsis>{sourceText(record)}</Typography.Text>
            {sender ? (
              <Typography.Text type="secondary" ellipsis>
                发送者: {sender}
              </Typography.Text>
            ) : null}
            {forwardOrigin ? (
              <Typography.Text type="secondary" ellipsis>
                原始: {forwardOrigin}
                {record.forwardMessageId ? ` #${record.forwardMessageId}` : ""}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "类型",
      dataIndex: "mediaType",
      key: "mediaType",
      width: 110,
      render: (value: string | undefined, record) => (
        <Space size={4}>
          <Tag>{value ?? "unknown"}</Tag>
          {record.mediaGroupId ? <Tag color="purple">group</Tag> : null}
        </Space>
      ),
    },
    {
      title: "进度",
      key: "progress",
      width: 150,
      render: (_, record) => (
        <Progress
          percent={["success", "skip", "failed", "stopped"].includes(record.status) ? 100 : 0}
          size="small"
          status={record.status === "failed" ? "exception" : undefined}
        />
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value: DownloadRecord["status"]) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag>,
    },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      width: 110,
      render: (value?: number) => formatByte(value ?? 0),
    },
  ];
}

export function createDownloadRecordColumns(): ColumnsType<DownloadRecord> {
  return [
    ...createDownloadColumns(),
    {
      title: "触发",
      dataIndex: "source",
      key: "source",
      width: 90,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "消息",
      key: "message",
      width: 160,
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Tag>{record.messageId}</Tag>
          {record.mediaGroupId ? (
            <Typography.Text type="secondary" ellipsis>
              {record.mediaGroupId}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "保存路径",
      dataIndex: "savePath",
      key: "savePath",
      ellipsis: true,
      width: 320,
      render: (value: string | undefined, record) => (
        <Space orientation="vertical" size={4} style={{ maxWidth: 300 }}>
          <Typography.Text ellipsis>{value || "-"}</Typography.Text>
          {record.status === "success" && value ? (
            <Button
              size="small"
              icon={<ExportOutlined />}
              href={`/api/downloads/${record.id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              打开
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];
}
