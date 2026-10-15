import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectDefinition, AllowedAction } from '../domain/entities/project-definition.entity.js'

export type { AllowedAction, ProjectDefinition }

export const DEFAULT_PROJECTS_CATALOG: ProjectDefinition[] = [
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
    allowedActions: ['create_issue'],
  },
]

export function loadProjectsCatalog(): ProjectDefinition[] {
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const jsonPath = path.resolve(__dirname, 'projects.catalog.json')

    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ProjectDefinition[]
      }
    }
  } catch (error) {
    console.warn('[ProjectsRegistry] Falha ao ler projects.catalog.json, usando catálogo padrão:', error)
  }

  return DEFAULT_PROJECTS_CATALOG
}

export const PROJECTS_CATALOG: ProjectDefinition[] = loadProjectsCatalog()
