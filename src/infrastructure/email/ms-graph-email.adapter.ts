import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { IEmailReaderPort, RawEmailMessage } from '../../domain/ports/email-reader.port.js'

export interface MSGraphEmailAdapterConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  mailboxUser: string
}

export class MSGraphEmailAdapter implements IEmailReaderPort {
  private readonly client: Client
  private readonly mailboxUser: string

  constructor(config: MSGraphEmailAdapterConfig) {
    this.mailboxUser = config.mailboxUser

    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret
    )

    this.client = Client.init({
      authProvider: async (done) => {
        try {
          const token = await credential.getToken('https://graph.microsoft.com/.default')
          done(null, token.token)
        } catch (error) {
          done(error as Error, null)
        }
      },
    })
  }

  async fetchUnreadMessages(): Promise<RawEmailMessage[]> {
    const response = await this.client
      .api(`/users/${this.mailboxUser}/mailFolders/Inbox/messages`)
      .filter('isRead eq false')
      .top(25)
      .select('id,subject,from,receivedDateTime,body,hasAttachments')
      .orderby('receivedDateTime asc')
      .get()

    const rawMessages: any[] = response.value || []
    const messages: RawEmailMessage[] = []

    for (const msg of rawMessages) {
      const isHtml = msg.body?.contentType?.toLowerCase() === 'html'
      const content = msg.body?.content || ''
      const bodyText = isHtml ? this.stripHtml(content) : content

      const attachments: { name: string; contentType: string; contentBase64: string }[] = []

      if (msg.hasAttachments) {
        try {
          const attRes = await this.client
            .api(`/users/${this.mailboxUser}/messages/${msg.id}/attachments`)
            .get()

          const attList = attRes.value || []
          for (const a of attList) {
            // Suporta anexos de arquivo de imagem (prints, screenshots)
            if (a.contentBytes && a.contentType && a.contentType.toLowerCase().startsWith('image/')) {
              attachments.push({
                name: a.name || 'screenshot.png',
                contentType: a.contentType.toLowerCase(),
                contentBase64: a.contentBytes,
              })
            }
          }
        } catch (attErr) {
          console.warn(`[MSGraph] Não foi possível baixar anexos da mensagem ${msg.id}:`, attErr)
        }
      }

      messages.push({
        id: msg.id,
        subject: msg.subject || '(Sem Assunto)',
        from: {
          name: msg.from?.emailAddress?.name || undefined,
          address: msg.from?.emailAddress?.address || 'unknown@domain.com',
        },
        receivedAt: new Date(msg.receivedDateTime || Date.now()),
        bodyText,
        bodyHtml: isHtml ? content : undefined,
        attachmentsCount: msg.hasAttachments ? attachments.length || 1 : 0,
        attachments,
      })
    }

    return messages
  }

  async markAsProcessed(messageId: string): Promise<void> {
    await this.client
      .api(`/users/${this.mailboxUser}/messages/${messageId}`)
      .patch({ isRead: true })
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}
