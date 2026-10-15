export interface SendEmailInput {
  to: string[]
  subject: string
  htmlBody: string
}

export interface IEmailSenderPort {
  sendEmail(input: SendEmailInput): Promise<void>
}
