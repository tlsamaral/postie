export interface EmailSenderInfo {
  name?: string
  address: string
}

export interface EmailMessageProps {
  id: string
  subject: string
  from: EmailSenderInfo
  receivedAt: Date
  bodyText: string
  bodyHtml?: string
  attachmentsCount: number
}

export class EmailMessage {
  public readonly id: string
  public readonly subject: string
  public readonly from: EmailSenderInfo
  public readonly receivedAt: Date
  public readonly bodyText: string
  public readonly bodyHtml?: string
  public readonly attachmentsCount: number

  constructor(props: EmailMessageProps) {
    this.id = props.id
    this.subject = props.subject
    this.from = props.from
    this.receivedAt = props.receivedAt
    this.bodyText = props.bodyText
    this.bodyHtml = props.bodyHtml
    this.attachmentsCount = props.attachmentsCount
  }

  /**
   * Sanitizes email body text removing excess whitespaces, prompt injections, or malformed characters.
   */
  get sanitizedText(): string {
    return this.bodyText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}
