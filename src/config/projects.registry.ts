import { ProjectDefinition, AllowedAction } from '../domain/entities/project-definition.entity.js'

export type { AllowedAction, ProjectDefinition }

export const PROJECTS_CATALOG: ProjectDefinition[] = [
  {
    id: 'portal-cliente',
    name: 'Portal do Cliente',
    description: 'Área logada onde clientes acompanham pedidos e faturas.',
    scopeBoundaries: [
      'Pertence: problemas de login, segunda via de boleto, status de pedido.',
      'Não pertence: dúvidas comerciais, negociação de preço, cancelamento de contrato.',
    ],
    github: {
      owner: 'minha-organizacao',
      repo: 'portal-cliente',
    },
    allowedActions: ['create_issue', 'update_priority', 'comment'],
  },
  {
    id: 'erp-integrador',
    name: 'Integrador ERP',
    description: 'Sincronização de pedidos, estoque e financeiro com o ERP.',
    scopeBoundaries: [
      'Pertence: falhas de webhook, sincronia de boletos, divergência cadastral de clientes.',
    ],
    github: {
      owner: 'minha-organizacao',
      repo: 'erp-sync-service',
    },
    // Limitação de ação estrita: Apenas cria issue para revisão humana
    allowedActions: ['create_issue'],
  },
]
