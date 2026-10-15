import { GoogleGenAI, Type, Schema } from '@google/genai'
import { IAIRouterPort, RoutingDecision } from '../../domain/ports/ai-router.port.js'
import { RawEmailMessage } from '../../domain/ports/email-reader.port.js'
import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'

export interface GeminiRouterAdapterOptions {
  apiKey: string
  modelName?: string
}

export class GeminiRouterAdapter implements IAIRouterPort {
  private readonly ai: GoogleGenAI
  private readonly modelName: string

  constructor(options: GeminiRouterAdapterOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey })
    this.modelName = options.modelName || 'gemini-2.5-flash'
  }

  async classifyAndRoute(
    email: RawEmailMessage,
    availableProjects: ProjectDefinition[]
  ): Promise<RoutingDecision> {
    const catalogDescription = availableProjects
      .map(
        (p) =>
          `Projeto ID: "${p.id}"\n` +
          `Nome: "${p.name}"\n` +
          `Descrição: ${p.description}\n` +
          `Fronteiras de Escopo (Guardrails):\n${p.scopeBoundaries.map((b) => ` - ${b}`).join('\n')}`
      )
      .join('\n\n---\n\n')

    const prompt = `Você é um Engenheiro Sênior de Triagem e Roteamento de Chamados Técnicos.
Sua missão é analisar o email recebido e decidir para qual projeto do catálogo ele deve ser roteado, garantindo o estrito cumprimento das fronteiras de escopo (guardrails).

### Catálogo de Projetos Disponíveis:
${catalogDescription}

### Email Recebido:
- ID: ${email.id}
- Assunto: ${email.subject}
- De: ${email.from.name ? `${email.from.name} <${email.from.address}>` : email.from.address}
- Data de Recebimento: ${email.receivedAt.toISOString()}
- Anexos: ${email.attachmentsCount}
- Conteúdo do Email:
"""
${email.bodyText.trim() || '(Sem texto no corpo do email)'}
"""

### Regras de Avaliação:
1. Se o email não pertencer estritamente a nenhum projeto (ex: spam, notificações automáticas, propaganda ou assunto fora de escopo), matchedProjectId DEVE ser null.
2. Seja conservador com o nível de confiança (0.0 a 1.0).
3. Categoria DEVE ser: BUG, FEATURE_REQUEST, QUESTION ou SPAM.
4. Sugira a prioridade inicial: LOW, MEDIUM, HIGH ou CRITICAL (use CRITICAL somente para paradas totais de serviço/sistemas fora do ar).
5. Escreva um título claro e objetivo para o ticket.
6. Escreva uma descrição limpa em Markdown para a issue, formatando contexto, descrição do problema, impactos e passos/evidências mencionadas.`

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        matchedProjectId: {
          type: Type.STRING,
          description:
            'O ID exato do projeto correspondente do catálogo, ou vazio/null se nenhum projeto for compatível',
          nullable: true,
        },
        confidence: {
          type: Type.NUMBER,
          description: 'Confiança da decisão entre 0.0 e 1.0',
        },
        reasoning: {
          type: Type.STRING,
          description: 'Justificativa clara da decisão tomada',
        },
        category: {
          type: Type.STRING,
          enum: ['BUG', 'FEATURE_REQUEST', 'QUESTION', 'SPAM'],
          description: 'Categoria do chamado',
        },
        ticketTitle: {
          type: Type.STRING,
          description: 'Título claro e conciso para a issue',
        },
        ticketMarkdownBody: {
          type: Type.STRING,
          description: 'Corpo da issue estruturado em Markdown limpo',
        },
        suggestedPriority: {
          type: Type.STRING,
          enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          description: 'Prioridade sugerida para o chamado',
        },
      },
      required: [
        'confidence',
        'reasoning',
        'category',
        'ticketTitle',
        'ticketMarkdownBody',
        'suggestedPriority',
      ],
    }

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1,
      },
    })

    const rawText = response.text?.trim()
    if (!rawText) {
      throw new Error('Resposta vazia recebida da API Gemini')
    }

    const parsed = JSON.parse(rawText)

    const validCategories = ['BUG', 'FEATURE_REQUEST', 'QUESTION', 'SPAM'] as const
    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

    const category = validCategories.includes(parsed.category) ? parsed.category : 'QUESTION'
    const suggestedPriority = validPriorities.includes(parsed.suggestedPriority)
      ? parsed.suggestedPriority
      : 'MEDIUM'

    let matchedProjectId: string | null = parsed.matchedProjectId || null
    if (matchedProjectId && !availableProjects.some((p) => p.id === matchedProjectId)) {
      matchedProjectId = null
    }

    return {
      matchedProjectId,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: parsed.reasoning || '',
      category,
      ticketTitle: parsed.ticketTitle || email.subject || 'Chamado sem título',
      ticketMarkdownBody: parsed.ticketMarkdownBody || email.bodyText,
      suggestedPriority,
    }
  }
}
