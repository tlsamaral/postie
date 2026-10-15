export interface RawEmailMessage {
  id: string
  subject: string
  from: { name?: string; address: string }
  receivedAt: Date
  bodyText: string
  bodyHtml?: string
  attachmentsCount: number
}

export interface IEmailReaderPort {
  /**
   * Busca mensagens não processadas na caixa de entrada
   */
  fetchUnreadMessages(): Promise<RawEmailMessage[]>

  /**
   * Marca a mensagem como lida ou processada para evitar duplicidade
   */
  markAsProcessed(messageId: string): Promise<void>
}
