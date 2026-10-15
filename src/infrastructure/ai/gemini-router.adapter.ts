import { GoogleGenAI, Type, Schema } from '@google/genai'
import { IAIRouterPort, RoutingDecision, DuplicateVerificationResult } from '../../domain/ports/ai-router.port.js'
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
3. Categoria DEVE ser: BUG, FEATURE_REQUEST, QUESTION ou SPAM:
   - **QUESTION (Dúvida / Suporte Operacional):** Use para problemas pontuais de credenciais ou login de um único usuário (ex: "erro de login e senha", "esqueci a senha", "usuário não consegue logar"), dúvidas de uso ou pedidos de permissão individual.
   - **BUG (Defeito no Sistema):** Use APENAS quando houver evidência de falha no código/sistema (ex: erro 500, exceções, crashes, botão que não responde, tela branca, totem travado) ou quando houver relatos de múltiplos usuários afetados.
   - **FEATURE_REQUEST:** Pedidos de novas funcionalidades ou alterações de regras de negócio.
   - **SPAM:** Propagandas, phishing ou newsletters irrelevantes.
4. Sugira a prioridade inicial com base no impacto real:
   - **LOW:** Problemas isolados de um único usuário (ex: erro de login/senha individual, dúvida simples).
   - **MEDIUM:** Falha em recurso secundário que não impede o fluxo principal ou tem contorno fácil.
   - **HIGH:** Falha em serviço crítico que afeta múltiplos usuários (ex: totens de fila, emissão de boletos, inscrições de bolsas).
   - **CRITICAL:** Parada total do sistema / indisponibilidade geral do serviço.
5. Escreva um título claro e objetivo para o ticket.
6. Escreva uma descrição limpa em Markdown para a issue, formatando contexto, descrição do problema, impactos e passos/evidências mencionadas (incluindo o que foi visto nas imagens/prints anexados se houver).`

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

    // Suporte Multimodal: Adiciona o prompt de texto e quaisquer prints/imagens anexadas
    const contents: any[] = [{ text: prompt }]

    if (email.attachments && email.attachments.length > 0) {
      for (const att of email.attachments) {
        if (att.contentType.startsWith('image/')) {
          contents.push({
            inlineData: {
              mimeType: att.contentType,
              data: att.contentBase64,
            },
          })
        }
      }
    }

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents,
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

### Regras de Decisão:
1. isDuplicate = true: Apenas se os dois chamados relatarem exatamente a MESMA falha técnica, mesmo defeito no software ou mesma interrupção de serviço (reincidência do mesmo bug).
2. isDuplicate = false: Se forem problemas técnicos distintos, componentes diferentes, causas-raiz diferentes ou solicitações separadas, MESMO QUE pertençam ao mesmo módulo ou sistema.

Retorne JSON com:
- isDuplicate: boolean (true se for a mesma falha técnica; false se forem problemas distintos)
- reasoning: string (justificativa técnica concisa)`

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isDuplicate: { type: Type.BOOLEAN },
              reasoning: { type: Type.STRING },
            },
            required: ['isDuplicate', 'reasoning'],
          },
          temperature: 0.1,
        },
      })

      const raw = response.text?.trim()
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          isDuplicate: Boolean(parsed.isDuplicate),
          reasoning: parsed.reasoning || '',
        }
      }
    } catch (err) {
      console.warn('[GeminiRouter] Falha na verificação semântica de duplicidade, mantendo decisão léxica:', err)
    }

    return { isDuplicate: true, reasoning: 'Fallback para similaridade de termos' }
  }
}
