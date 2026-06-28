"use client";

import { DeleteOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Form, Input, Modal, Progress, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadsPage } from "@/components/console/pages/downloads-page";
import { useTasksData } from "@/components/console/hooks/use-tasks-data";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import { taskCounterValue, taskStatusColors, taskStatusLabels } from "@/components/console/utils";
import type { TaskRecord } from "@/types/console";
import { formatByte } from "@/utils/format";

type TasksPageTab = "tasks" | "downloads";

export function TasksPage({ initialTab = "tasks" }: { initialTab?: TasksPageTab }) {
  const { queue } = useConsoleRuntime();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TasksPageTab>(initialTab);
  const {
    tasks,
    loading,
    addTaskForm,
    deleteTaskForm,
    addTaskOpen,
    setAddTaskOpen,
    addingTask,
    deleteTaskOpen,
    setDeleteTaskOpen,
    deletingTask,
    selectedTaskIds,
    setSelectedTaskIds,
    pendingDeleteTaskIds,
    loadTasks,
    stopTask,
    stopAllTasks,
    addManualTask,
    openDeleteTasks,
    deleteSelectedTasks,
    confirmDeleteTasks,
  } = useTasksData();

  const taskColumns: ColumnsType<TaskRecord> = useMemo(
    () => [
      {
        title: "任务",
        key: "task",
        width: 240,
        render: (_, record) => (
          <Space orientation="vertical" size={0} style={{ maxWidth: 220 }}>
            <Typography.Text ellipsis>{record.chatTitle || record.chatId}</Typography.Text>
            <Typography.Text type="secondary" ellipsis>
              {record.externalId}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "类型",
        dataIndex: "taskType",
        key: "taskType",
        width: 120,
        render: (value: string) => <Tag>{value}</Tag>,
      },
      {
        title: "进度",
        key: "counters",
        width: 220,
        render: (_, record) => {
          const total = taskCounterValue(record.totalCount);
          const success = taskCounterValue(record.successCount);
          const failed = taskCounterValue(record.failedCount);
          const skipped = taskCounterValue(record.skipCount);
          const stopped = taskCounterValue(record.stoppedCount);
          const done = success + failed + skipped + stopped;
          const percent = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <Space orientation="vertical" size={2} style={{ width: 180 }}>
              <Progress percent={percent} size="small" />
              <Typography.Text type="secondary">
                {done}/{total} 成功 {success} 失败 {failed} 跳过 {skipped} 停止 {stopped}
              </Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 110,
        render: (value: TaskRecord["status"]) => (
          <Tag color={taskStatusColors[value]}>{taskStatusLabels[value]}</Tag>
        ),
      },
      {
        title: "流量",
        dataIndex: "totalBytes",
        key: "totalBytes",
        width: 110,
        render: (value: number) => formatByte(value ?? 0),
      },
      {
        title: "操作",
        key: "actions",
        width: 190,
        render: (_, record) => (
          <Space size={8} wrap>
            <Button
              danger
              size="small"
              icon={<StopOutlined />}
              disabled={record.status !== "queued" && record.status !== "running"}
              onClick={() => void stopTask(record.externalId)}
            >
              停止
            </Button>
            <Button
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => openDeleteTasks([record.id])}
            >
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [openDeleteTasks, stopTask],
  );
  const taskList = (
    <Card
      title="任务列表"
      extra={
        <Space>
          <Button icon={<PlusOutlined />} onClick={() => setAddTaskOpen(true)}>
            添加任务
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadTasks()} />
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selectedTaskIds.length === 0}
            onClick={() => void deleteSelectedTasks()}
          >
            批量删除
          </Button>
          <Button danger icon={<StopOutlined />} onClick={() => void stopAllTasks()}>
            停止全部
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={taskColumns}
        dataSource={tasks}
        loading={loading}
        size="middle"
        rowSelection={{
          selectedRowKeys: selectedTaskIds,
          onChange: (keys) => setSelectedTaskIds(keys.map((key) => Number(key)).filter(Number.isFinite)),
        }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1040 }}
      />
    </Card>
  );

  return (
    <>
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <section className="metric-grid">
          <Card>
            <Statistic title="运行" value={queue?.stats?.running ?? 0} />
          </Card>
          <Card>
            <Statistic title="排队" value={queue?.stats?.queued ?? 0} />
          </Card>
          <Card>
            <Statistic title="失败" value={queue?.stats?.failed ?? 0} />
          </Card>
          <Card>
            <Statistic title="已停止" value={queue?.stats?.stopped ?? 0} />
          </Card>
        </section>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            const nextTab = key === "downloads" ? "downloads" : "tasks";
            setActiveTab(nextTab);
            router.replace(nextTab === "downloads" ? "/tasks?tab=downloads" : "/tasks", { scroll: false });
          }}
          items={[
            {
              key: "tasks",
              label: "任务列表",
              children: taskList,
            },
            {
              key: "downloads",
              label: "下载明细",
              children: <DownloadsPage />,
            },
          ]}
        />
        <Modal
          title="添加下载任务"
          open={addTaskOpen}
          okText="添加并入队"
          cancelText="取消"
          confirmLoading={addingTask}
          onOk={() => void addManualTask()}
          onCancel={() => {
            setAddTaskOpen(false);
            addTaskForm.resetFields();
          }}
          forceRender
        >
          <Form form={addTaskForm} layout="vertical">
            <Form.Item
              name="input"
              label="下载链接 / Telegram 消息链接"
              rules={[{ required: true, message: "请输入一条链接" }]}
            >
              <Input.TextArea rows={4} placeholder="https://example.com/video 或 https://t.me/xxx/123" />
            </Form.Item>
            <Form.Item name="filter" label="过滤器">
              <Input placeholder="可选，复用现有 filter DSL" />
            </Form.Item>
          </Form>
        </Modal>
        <Modal
          title={pendingDeleteTaskIds.length > 1 ? "批量删除任务" : "删除任务"}
          open={deleteTaskOpen}
          okText="确认删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          confirmLoading={deletingTask}
          onOk={() => void confirmDeleteTasks()}
          onCancel={() => {
            setDeleteTaskOpen(false);
            deleteTaskForm.resetFields();
          }}
          forceRender
        >
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Typography.Text>
              将删除 {pendingDeleteTaskIds.length} 个任务及其队列项、下载记录。运行中的任务会先停止再删除。
            </Typography.Text>
            <Form form={deleteTaskForm} layout="vertical" initialValues={{ deleteFiles: false }}>
              <Form.Item name="deleteFiles" valuePropName="checked" noStyle>
                <Checkbox>同时删除已下载文件</Checkbox>
              </Form.Item>
            </Form>
          </Space>
        </Modal>
      </Space>
    </>
  );
}
