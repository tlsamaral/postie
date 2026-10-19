import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { IEmailReaderPort, RawEmailMessage } from '../../domain/ports/email-reader.port.js'

export interface ImapEmailAdapterConfig {
  host: string
  port?: number
  secure?: boolean
  auth: {
    user: string
    pass: string
  }
}

export class ImapEmailAdapter implements IEmailReaderPort {
  constructor(private readonly config: ImapEmailAdapterConfig) {}

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.host,
      port: this.config.port ?? 993,
      secure: this.config.secure ?? true,
      auth: {
        user: this.config.auth.user,
        pass: this.config.auth.pass,
      },
      logger: false,
    })
  }

  async fetchUnreadMessages(): Promise<RawEmailMessage[]> {
    const client = this.createClient()
    await client.connect()

    const lock = await client.getMailboxLock('INBOX')
    const messages: RawEmailMessage[] = []

    try {
      const searchResult = await client.search({ seen: false })
      const uids = Array.isArray(searchResult) ? searchResult : []

      for (const uid of uids) {
        const messageData = await client.fetchOne(String(uid), {
          source: true,
          uid: true,
          envelope: true,
        })

        if (!messageData || !messageData.source) continue

        const parsed = await simpleParser(messageData.source)

        const fromAddress = parsed.from?.value?.[0]?.address || 'unknown@domain.com'
        const fromName = parsed.from?.value?.[0]?.name

        messages.push({
          id: String(messageData.uid),
          subject: parsed.subject || '(Sem Assunto)',
          from: {
            name: fromName,
            address: fromAddress,
          },
          receivedAt: parsed.date || new Date(),
          bodyText: parsed.text || '',
          bodyHtml: typeof parsed.html === 'string' ? parsed.html : undefined,
          attachmentsCount: parsed.attachments?.length || 0,
        })
      }
    } finally {
      lock.release()
      await client.logout()
    }

    return messages
  }

  async markAsProcessed(messageId: string): Promise<void> {
    const client = this.createClient()
    await client.connect()

    const lock = await client.getMailboxLock('INBOX')
    try {
      await client.messageFlagsAdd(messageId, ['\\Seen'], { uid: true })
    } finally {
      lock.release()
      await client.logout()
    }
  }
}
