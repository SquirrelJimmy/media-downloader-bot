"use client";

import { useCallback, useState } from "react";
import { App, Form } from "antd";
import type {
  AppConfigPayload,
  PluginFormValues,
  SettingsFormValues,
} from "@/types/console";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";
import {
  mergeTelegramSettingsConfig,
  mergePluginConfig,
  mergeSettingsConfig,
  pluginFormValues,
  settingsFormValues,
  validateCloudSettings,
  validateTelegramForwardSettings,
  validateTelegramLoginSettings,
} from "@/components/console/utils";

type ConfigFormScope = "all" | "plugins" | "settings";

export function useConfigData(options: { formScope?: ConfigFormScope } = {}) {
  const formScope = options.formScope ?? "all";
  const { message } = App.useApp();
  const [pluginForm] = Form.useForm<PluginFormValues>();
  const [settingsForm] = Form.useForm<SettingsFormValues>();
  const [config, setConfig] = useState<AppConfigPayload | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const applyConfigToForms = useCallback(
    (nextConfig: AppConfigPayload) => {
      if (formScope === "all" || formScope === "plugins") {
        pluginForm.setFieldsValue(pluginFormValues(nextConfig));
      }
      if (formScope === "all" || formScope === "settings") {
        settingsForm.setFieldsValue(settingsFormValues(nextConfig));
      }
    },
    [formScope, pluginForm, settingsForm],
  );

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const result = await fetchJson<AppConfigPayload & { error?: string }>("/api/config");
      if (redirectToLoginForAuthError(result)) {
        return null;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "加载配置失败");
        return null;
      }
      const data = result.data;
      setConfig(data);
      applyConfigToForms(data);
      return data;
    } finally {
      setConfigLoading(false);
    }
  }, [applyConfigToForms, message]);

  const saveConfig = useCallback(
    async (nextConfig: AppConfigPayload) => {
      setConfigSaving(true);
      try {
        const result = await fetchJson<AppConfigPayload & { error?: string }>("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(nextConfig),
        });
        if (redirectToLoginForAuthError(result)) {
          return null;
        }
        if (!result.ok || !result.data) {
          message.error(result.error ?? "保存配置失败");
          return null;
        }
        const data = result.data;
        setConfig(data);
        applyConfigToForms(data);
        message.success("配置已保存，运行中的 Bot/worker 需要重启或重新加载后生效");
        return data;
      } finally {
        setConfigSaving(false);
      }
    },
    [applyConfigToForms, message],
  );

  const savePluginSettings = useCallback(async () => {
    const currentConfig = config ?? await loadConfig();
    if (!currentConfig) {
      return;
    }
    await pluginForm.validateFields();
    const values = pluginForm.getFieldsValue(true);
    await saveConfig(mergePluginConfig(currentConfig, values));
  }, [config, loadConfig, pluginForm, saveConfig]);

  const saveRuntimeSettings = useCallback(async () => {
    const currentConfig = config ?? await loadConfig();
    if (!currentConfig) {
      return;
    }
    const values = await settingsForm.validateFields();
    const validationErrors = [...validateCloudSettings(values), ...validateTelegramForwardSettings(values)];
    if (validationErrors.length > 0) {
      message.error(validationErrors[0]);
      return;
    }
    await saveConfig(mergeSettingsConfig(currentConfig, values));
  }, [config, loadConfig, message, saveConfig, settingsForm]);

  const saveTelegramSettings = useCallback(async () => {
    const currentConfig = config ?? await loadConfig();
    if (!currentConfig) {
      return null;
    }
    await settingsForm.validateFields([
      "telegramApiId",
      "telegramApiHash",
      "telegramBotToken",
      "telegramAllowedUserIds",
      "telegramSessionsDir",
      "telegramUserSession",
      "telegramPhone",
    ]);
    const values = settingsForm.getFieldsValue(true);
    const validationErrors = validateTelegramLoginSettings(values);
    if (validationErrors.length > 0) {
      message.error(validationErrors[0]);
      return null;
    }
    return await saveConfig(mergeTelegramSettingsConfig(currentConfig, values));
  }, [config, loadConfig, message, saveConfig, settingsForm]);

  return {
    config,
    pluginForm,
    settingsForm,
    configLoading,
    configSaving,
    loadConfig,
    savePluginSettings,
    saveRuntimeSettings,
    saveTelegramSettings,
  };
}
