import { IEmailSenderPort, SendEmailInput } from '../../domain/ports/email-sender.port.js'

export class ConsoleNotifierAdapter implements IEmailSenderPort {
  async sendEmail(input: SendEmailInput): Promise<void> {
    console.info('================ [NOTIFICATION EMAIL] ================')
    console.info(`To: ${input.to.join(', ')}`)
    console.info(`Subject: ${input.subject}`)
    console.info('Body (HTML snippet):')
    console.info(input.htmlBody.substring(0, 300) + '...')
    console.info('======================================================')
  }
}
