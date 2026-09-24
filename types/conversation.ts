export type ConversationRole = "user" | "assistant" | "system";

export type ConversationInputMode = "text" | "voice" | "system" | "external";

export type ConversationStatus = "active" | "archived";

export type ConversationMessageStatus = "final" | "draft" | "error";

export type StoredConversationMessage = {
  id: string;
  organizationId: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  inputMode: ConversationInputMode;
  status: ConversationMessageStatus;
  visible: boolean;
  stored: true;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export const CONTEXT_WINDOW_SIZE = 8;
