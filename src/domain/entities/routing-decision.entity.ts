export type TicketCategory = 'BUG' | 'FEATURE_REQUEST' | 'QUESTION' | 'SPAM'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RoutingDecision {
  /** Null when the message falls outside all project scope boundaries */
  matchedProjectId: string | null
  confidence: number
  reasoning: string
  category: TicketCategory
  ticketTitle: string
  ticketMarkdownBody: string
  suggestedPriority: TicketPriority
}
