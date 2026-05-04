export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePayload {
  headers: GmailMessageHeader[];
  mimeType: string;
  filename?: string;
  body?: { data?: string; size: number; attachmentId?: string };
  parts?: GmailMessagePayload[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailMessagePayload;
  internalDate: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface GmailThread {
  id: string;
  snippet: string;
  messages: GmailMessage[];
}

export interface ParsedEmail {
  id: string;
  threadId: string;
  labelIds: string[];
  subject: string;
  from: string;
  fromName: string;
  fromEmail: string;
  date: string;
  snippet: string;
  isUnread: boolean;
  isStarred: boolean;
  isImportant?: boolean;
  hasAttachments?: boolean;
  messageCount?: number;
  reminderDate?: string;
  snoozeUntil?: string;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  messageId: string;
}

export class TokenExpiredError extends Error {
  constructor() {
    super('Gmail token expired');
    this.name = 'TokenExpiredError';
  }
}

export class GmailApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}
