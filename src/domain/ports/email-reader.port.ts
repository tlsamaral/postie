export interface EmailAttachment {
  name: string
  contentType: string
  contentBase64: string
}

export interface RawEmailMessage {
  id: string
  subject: string
  from: { name?: string; address: string }
  receivedAt: Date
  bodyText: string
  bodyHtml?: string
  attachmentsCount: number
  attachments?: EmailAttachment[]
}

/**
 * Output Port for email ingestion and state acknowledgment across providers (MS Graph, IMAP).
 */
export interface IEmailReaderPort {
  fetchUnreadMessages(): Promise<RawEmailMessage[]>
  markAsProcessed(messageId: string): Promise<void>
}
