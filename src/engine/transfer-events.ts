import type { DownloadResult } from "@/plugins/types";
import type { TaskNode } from "@/types/download";

export type TransferPhase = "upload" | "forward";

export function defaultTransferJobId(node: TaskNode, result: DownloadResult, phase: TransferPhase) {
  return `${node.id}:${result.message?.id ?? result.filePath ?? result.fileName ?? phase}`;
}

export function createTransferSpeedTracker() {
  let lastBytes = 0;
  let lastAt = Date.now();

  return (transferred: number) => {
    const now = Date.now();
    const elapsedSeconds = (now - lastAt) / 1000;
    const deltaBytes = transferred - lastBytes;
    lastBytes = transferred;
    lastAt = now;
    return elapsedSeconds > 0 ? Math.max(0, deltaBytes / elapsedSeconds) : 0;
  };
}

export function transferProgressPayload(input: {
  phase: TransferPhase;
  jobId: string;
  node: TaskNode;
  result: DownloadResult;
  transferred: number;
  total: number;
  speed: number;
  remotePath?: string;
}) {
  const message = input.result.message;
  return {
    jobId: input.jobId,
    phase: input.phase,
    taskId: input.node.id,
    taskType: input.node.type,
    chatId: message?.chatId ?? input.node.chatId,
    chatTitle: message?.chatTitle ?? input.node.chatTitle,
    messageId: message?.id,
    fileName: input.result.fileName ?? message?.fileName,
    mediaType: message?.mediaType,
    senderId: message?.senderId,
    senderName: message?.senderName,
    forwardChatId: message?.forwardOrigin?.chatId,
    forwardChatTitle: message?.forwardOrigin?.chatTitle,
    forwardSenderId: message?.forwardOrigin?.senderId,
    forwardSenderName: message?.forwardOrigin?.senderName,
    forwardMessageId: message?.forwardOrigin?.messageId,
    mediaGroupId: message?.mediaGroupId,
    filePath: input.result.filePath,
    remotePath: input.remotePath,
    downloaded: input.transferred,
    total: input.total,
    speed: input.speed,
  };
}
