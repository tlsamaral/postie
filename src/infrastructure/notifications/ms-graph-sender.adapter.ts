import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { IEmailSenderPort, SendEmailInput } from '../../domain/ports/email-sender.port.js'

export interface MSGraphSenderAdapterConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  mailboxUser: string
}

export class MSGraphSenderAdapter implements IEmailSenderPort {
  private readonly client: Client
  private readonly mailboxUser: string

  constructor(config: MSGraphSenderAdapterConfig) {
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

  async sendEmail(input: SendEmailInput): Promise<void> {
    const message = {
      subject: input.subject,
      body: {
        contentType: 'HTML',
        content: input.htmlBody,
      },
      toRecipients: input.to.map((recipient) => ({
        emailAddress: {
          address: recipient,
        },
      })),
    }

    await this.client
      .api(`/users/${this.mailboxUser}/sendMail`)
      .post({
        message,
        saveToSentItems: true,
      })
  }
}
