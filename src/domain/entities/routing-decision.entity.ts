export type TicketCategory = 'BUG' | 'FEATURE_REQUEST' | 'QUESTION' | 'SPAM'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RoutingDecision {
  matchedProjectId: string | null // null se fora de escopo / irrelevante
  confidence: number // 0.0 a 1.0
  reasoning: string
  category: TicketCategory
  ticketTitle: string
  ticketMarkdownBody: string
  suggestedPriority: TicketPriority
}
