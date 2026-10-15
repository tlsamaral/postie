import { ProjectDefinition } from '../entities/project-definition.entity.js'
import { RawEmailMessage } from './email-reader.port.js'
import { RoutingDecision } from '../entities/routing-decision.entity.js'

export { RoutingDecision }

export interface DuplicateVerificationResult {
  isDuplicate: boolean
  reasoning: string
}

export interface IAIRouterPort {
  classifyAndRoute(
    email: RawEmailMessage,
    availableProjects: ProjectDefinition[]
  ): Promise<RoutingDecision>

  verifyDuplicate?(
    newTicket: { title: string; description: string },
    existingIssue: { id: string | number; title: string; body: string }
  ): Promise<DuplicateVerificationResult>
}
