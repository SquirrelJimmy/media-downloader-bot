import type { NormalizedMessage } from "@/types/download";

export interface FilterMetaData {
  message_id: number;
  message_date?: string;
  message_caption?: string;
  media_file_size?: number;
  media_file_name?: string;
  media_type?: string;
  file_extension?: string;
  sender_id?: string;
  sender_name?: string;
  reply_to_message_id?: number;
  message_thread_id?: number;
}

export function metadataFromMessage(message: NormalizedMessage): FilterMetaData {
  return {
    message_id: message.id,
    message_date: message.date,
    message_caption: message.caption ?? message.text,
    media_file_size: message.fileSize,
    media_file_name: message.fileName,
    media_type: message.mediaType,
    file_extension: message.fileName?.split(".").pop(),
    sender_id: message.senderId,
    sender_name: message.senderName,
    reply_to_message_id: message.replyToMessageId,
    message_thread_id: message.messageThreadId,
  };
}
