import { ProjectDefinition } from '../entities/project-definition.entity.js'
import { RawEmailMessage } from './email-reader.port.js'
import { RoutingDecision } from '../entities/routing-decision.entity.js'

export { RoutingDecision }

export interface IAIRouterPort {
  classifyAndRoute(
    email: RawEmailMessage,
    availableProjects: ProjectDefinition[]
  ): Promise<RoutingDecision>
}
