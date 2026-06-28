const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatByte(size: number, digits = 2) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), byteUnits.length - 1);
  const value = size / 1024 ** unitIndex;
  return `${value.toFixed(digits)} ${byteUnits[unitIndex]}`;
}

export function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

export function createProgressBar(current: number, total: number, length = 10) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  const filled = Math.round(ratio * length);
  return `${"█".repeat(filled)}${"░".repeat(length - filled)}`;
}
