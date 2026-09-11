export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_MAX_LENGTH = 2000;

export type Message = {
  message_id: string;
  sender_is_me: boolean;
  body: string;
  created_at: string;
};

export type MessageCursor = { beforeCreatedAt: string; beforeMessageId: string };
export type MessagePage = { messages: Message[]; hasEarlier: boolean };
export type MessageSendLock = { current: boolean };

function parseRpcMessages(data: unknown): Message[] {
  if (!Array.isArray(data)) throw new Error('Messages unavailable');
  return data.map((row) => {
    if (!row || typeof row.message_id !== 'string' || typeof row.sender_is_me !== 'boolean' ||
      typeof row.body !== 'string' || typeof row.created_at !== 'string' ||
      !Number.isFinite(Date.parse(row.created_at))) throw new Error('Messages unavailable');
    return { message_id: row.message_id, sender_is_me: row.sender_is_me,
      body: row.body, created_at: row.created_at };
  });
}

export function normalizeMessageBody(body: string): string | null {
  const normalized = body.trim();
  return normalized && normalized.length <= MESSAGE_MAX_LENGTH ? normalized : null;
}

export function beginMessageSend(lock: MessageSendLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function finishMessageSend(lock: MessageSendLock): void {
  lock.current = false;
}

export function mergeMessages(...groups: Message[][]): Message[] {
  const unique = new Map<string, Message>();
  for (const group of groups) for (const message of group) unique.set(message.message_id, message);
  return [...unique.values()].sort((left, right) => {
    const timeDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
    return timeDifference || left.message_id.localeCompare(right.message_id);
  });
}

export function getOlderMessageCursor(messages: Message[]): MessageCursor | null {
  const oldest = messages[0];
  return oldest ? { beforeCreatedAt: oldest.created_at, beforeMessageId: oldest.message_id } : null;
}

export async function loadMessages(connectionId: string, cursor: MessageCursor | null,
  signal: AbortSignal, pageSize = MESSAGE_PAGE_SIZE): Promise<MessagePage> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('list_messages', {
    connection_id: connectionId,
    before_created_at: cursor?.beforeCreatedAt ?? null,
    before_message_id: cursor?.beforeMessageId ?? null,
    limit_count: pageSize,
  }).abortSignal(signal);
  if (error) throw new Error('Messages unavailable');
  const newestFirst = parseRpcMessages(data);
  return { messages: [...newestFirst].reverse(), hasEarlier: newestFirst.length === pageSize };
}

export async function sendMessage(connectionId: string, body: string): Promise<void> {
  const normalizedBody = normalizeMessageBody(body);
  if (!normalizedBody) throw new Error('Message unavailable');
  const { supabase } = await import('./supabase');
  const { error } = await supabase.rpc('send_message', {
    connection_id: connectionId,
    body: normalizedBody,
  });
  if (error) throw new Error('Message unavailable');
}
