"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Form } from "antd";
import type { AddTaskFormValues, DeleteTaskFormValues, TaskRecord } from "@/types/console";
import { stopMessageText } from "@/components/console/utils";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";

export function useTasksData() {
  const { message } = App.useApp();
  const { eventVersion, refreshRuntime } = useConsoleRuntime();
  const [addTaskForm] = Form.useForm<AddTaskFormValues>();
  const [deleteTaskForm] = Form.useForm<DeleteTaskFormValues>();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [deleteTaskOpen, setDeleteTaskOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [pendingDeleteTaskIds, setPendingDeleteTaskIds] = useState<number[]>([]);

  const loadTasks = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const result = await fetchJson<{ data?: TaskRecord[] }>("/api/tasks?limit=100");
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (result.data) {
        setTasks(result.data.data ?? []);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTasks(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks]);

  useEffect(() => {
    if (eventVersion === 0) {
      return;
    }
    const timer = window.setTimeout(() => void loadTasks({ silent: true }), 400);
    return () => window.clearTimeout(timer);
  }, [eventVersion, loadTasks]);

  const refreshTasks = useCallback(async () => {
    await Promise.all([loadTasks(), refreshRuntime()]);
  }, [loadTasks, refreshRuntime]);

  const stopTask = useCallback(
    async (taskExternalId: string) => {
      const result = await fetchJson<{ error?: string; stoppedQueueItems?: number; abortedTransmissions?: number }>("/api/tasks/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskExternalId }),
      });
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "停止任务失败");
        return;
      }
      message.success(stopMessageText("已停止任务", result.data));
      await refreshTasks();
    },
    [message, refreshTasks],
  );

  const stopAllTasks = useCallback(async () => {
    const result = await fetchJson<{ error?: string; stoppedQueueItems?: number; abortedTransmissions?: number }>("/api/tasks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    if (redirectToLoginForAuthError(result)) {
      return;
    }
    if (!result.ok || !result.data) {
      message.error(result.error ?? "停止任务失败");
      return;
    }
    message.success(stopMessageText("已停止全部任务", result.data));
    await refreshTasks();
  }, [message, refreshTasks]);

  const addManualTask = useCallback(async () => {
    const values = await addTaskForm.validateFields();
    setAddingTask(true);
    try {
      const result = await fetchJson<{ error?: string }>("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: values.input,
          filter: values.filter?.trim() || undefined,
        }),
      });
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (!result.ok) {
        message.error(result.error ?? "添加任务失败");
        return;
      }
      message.success("已入队，worker 会自动下载");
      setAddTaskOpen(false);
      addTaskForm.resetFields();
      await refreshTasks();
    } finally {
      setAddingTask(false);
    }
  }, [addTaskForm, message, refreshTasks]);

  const openDeleteTasks = useCallback(
    (taskIds: number[]) => {
      const ids = Array.from(new Set(taskIds.filter((id) => Number.isInteger(id) && id > 0)));
      if (ids.length === 0) {
        return;
      }
      setPendingDeleteTaskIds(ids);
      deleteTaskForm.setFieldsValue({ deleteFiles: false });
      setDeleteTaskOpen(true);
    },
    [deleteTaskForm],
  );

  const deleteSelectedTasks = useCallback(async () => {
    openDeleteTasks(selectedTaskIds);
  }, [openDeleteTasks, selectedTaskIds]);

  const confirmDeleteTasks = useCallback(async () => {
    if (pendingDeleteTaskIds.length === 0) {
      setDeleteTaskOpen(false);
      return;
    }
    const values = deleteTaskForm.getFieldsValue();
    setDeletingTask(true);
    try {
      const result = await fetchJson<{
        error?: string;
        deletedTasks?: number;
        deletedDownloads?: number;
        deletedFiles?: number;
        missingFiles?: number;
        failedFiles?: number;
      }>("/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: pendingDeleteTaskIds,
          deleteFiles: Boolean(values.deleteFiles),
        }),
      });
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "删除任务失败");
        return;
      }
      const data = result.data;
      message.success(
        `已删除任务 ${data.deletedTasks ?? 0} 个，记录 ${data.deletedDownloads ?? 0} 条，文件 ${data.deletedFiles ?? 0} 个`,
      );
      if ((data.missingFiles ?? 0) > 0 || (data.failedFiles ?? 0) > 0) {
        message.warning(`文件缺失 ${data.missingFiles ?? 0} 个，删除失败 ${data.failedFiles ?? 0} 个`);
      }
      setDeleteTaskOpen(false);
      setPendingDeleteTaskIds([]);
      setSelectedTaskIds((current) => current.filter((id) => !pendingDeleteTaskIds.includes(id)));
      deleteTaskForm.resetFields();
      await refreshTasks();
    } finally {
      setDeletingTask(false);
    }
  }, [deleteTaskForm, message, pendingDeleteTaskIds, refreshTasks]);

  return {
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
    loadTasks: refreshTasks,
    stopTask,
    stopAllTasks,
    addManualTask,
    openDeleteTasks,
    deleteSelectedTasks,
    confirmDeleteTasks,
  };
}
