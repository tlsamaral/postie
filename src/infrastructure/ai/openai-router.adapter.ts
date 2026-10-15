import OpenAI from 'openai'
import { IAIRouterPort, RoutingDecision, DuplicateVerificationResult } from '../../domain/ports/ai-router.port.js'
import { RawEmailMessage } from '../../domain/ports/email-reader.port.js'
import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'

export interface OpenAIRouterAdapterOptions {
  apiKey: string
  modelName?: string
}

export class OpenAIRouterAdapter implements IAIRouterPort {
  private readonly client: OpenAI
  private readonly modelName: string

  constructor(options: OpenAIRouterAdapterOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey })
    this.modelName = options.modelName || 'gpt-4o-mini'
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
Analise o email recebido e decida para qual projeto do catálogo ele deve ser roteado, respeitando estritamente os guardrails de escopo.

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

Retorne OBRIGATORIAMENTE um JSON válido com os campos:
- matchedProjectId: string | null (ID do projeto compatível ou null se fora de escopo)
- confidence: number (0.0 a 1.0)
- reasoning: string (justificativa clara)
- category: "BUG" | "FEATURE_REQUEST" | "QUESTION" | "SPAM"
- ticketTitle: string (título limpo e objetivo, sem prefixos Fwd/Enc)
- ticketMarkdownBody: string (descrição estruturada em Markdown, focando na sugestão ou relato original caso o email seja encaminhado)
- suggestedPriority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"`

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Você é um assistente especializado em triagem e classificação de emails para issue trackers corporativos.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const rawText = response.choices[0]?.message?.content?.trim()
    if (!rawText) {
      throw new Error('Resposta vazia recebida da API OpenAI')
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

  async verifyDuplicate(
    newTicket: { title: string; description: string },
    existingIssue: { id: string | number; title: string; body: string }
  ): Promise<DuplicateVerificationResult> {
    const prompt = `Você é um Engenheiro de Software Sênior especialista em triagem de incidentes.
Avalie se o Novo Chamado trata do MESMO defeito técnico/incidente que o Chamado Existente (mesma falha/causa-raiz), ou se são problemas técnicos DIFERENTES que devem ter issues separadas.

### Chamado Existente (#${existingIssue.id}):
- Título: "${existingIssue.title}"
- Descrição:
"""
${existingIssue.body.slice(0, 1500)}
"""

### Novo Chamado:
- Título: "${newTicket.title}"
- Descrição:
"""
${newTicket.description.slice(0, 1500)}
"""

Retorne JSON no formato:
{
  "isDuplicate": boolean,
  "reasoning": string
}`

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      })

      const content = response.choices[0]?.message?.content?.trim()
      if (content) {
        const parsed = JSON.parse(content)
        return {
          isDuplicate: Boolean(parsed.isDuplicate),
          reasoning: parsed.reasoning || '',
        }
      }
    } catch (err) {
      console.warn('[OpenAIRouter] Falha na verificação semântica de duplicidade:', err)
    }

    return { isDuplicate: true, reasoning: 'Fallback léxico' }
  }
}
