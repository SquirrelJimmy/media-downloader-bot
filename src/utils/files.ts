import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

function isCrossDeviceRenameError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EXDEV");
}

export async function moveFileAcrossDevices(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
    await copyFile(source, destination);
    await unlink(source);
  }
}
