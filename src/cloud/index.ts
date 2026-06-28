import type { CloudUploadAdapter } from "@/cloud/adapter";
import { rcloneAdapter } from "@/cloud/rclone";

const adapters = new Map<string, CloudUploadAdapter>([[rcloneAdapter.name, rcloneAdapter]]);

export function getCloudUploadAdapter(name: string) {
  return adapters.get(name) ?? null;
}

export function registerCloudUploadAdapter(adapter: CloudUploadAdapter) {
  adapters.set(adapter.name, adapter);
}
