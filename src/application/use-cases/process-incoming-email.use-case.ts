import { IEmailReaderPort } from '../../domain/ports/email-reader.port.js'
import { IEmailSenderPort } from '../../domain/ports/email-sender.port.js'
import { IAIRouterPort } from '../../domain/ports/ai-router.port.js'
import { IIssueTrackerPort } from '../../domain/ports/issue-tracker.port.js'
import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'
import { DeduplicateAndSyncIssueUseCase } from './deduplicate-and-sync-issue.use-case.js'

export interface ProcessIncomingEmailOptions {
  alertNotificationEmail: string
}

export class ProcessIncomingEmailUseCase {
  private readonly deduplicateUseCase: DeduplicateAndSyncIssueUseCase

  constructor(
    private readonly emailReader: IEmailReaderPort,
    private readonly emailSender: IEmailSenderPort,
    private readonly aiRouter: IAIRouterPort,
    private readonly issueTracker: IIssueTrackerPort,
    private readonly projectsCatalog: ProjectDefinition[],
    private readonly options: ProcessIncomingEmailOptions,
    deduplicateUseCase?: DeduplicateAndSyncIssueUseCase
  ) {
    this.deduplicateUseCase = deduplicateUseCase ?? new DeduplicateAndSyncIssueUseCase(issueTracker)
  }

  async execute(): Promise<{ processedCount: number }> {
    const unreadEmails = await this.emailReader.fetchUnreadMessages()
    console.info(`[EmailWatcher] ${unreadEmails.length} email(s) não lido(s) encontrado(s).`)

    let processedCount = 0

    for (const email of unreadEmails) {
      try {
        console.info(`[Triage] Processando email [ID: ${email.id}] "${email.subject}" de ${email.from.address}`)

        // 1. Roteia com a IA
        const decision = await this.aiRouter.classifyAndRoute(email, this.projectsCatalog)

        if (!decision.matchedProjectId) {
          console.warn(`[Triage] Email fora de escopo: "${email.subject}" (Razão: ${decision.reasoning})`)
          await this.emailReader.markAsProcessed(email.id)
          processedCount++
          continue
        }

        const project = this.projectsCatalog.find((p) => p.id === decision.matchedProjectId)
        if (!project) {
          console.error(
            `[Triage] Projeto retornado pela IA (${decision.matchedProjectId}) não foi localizado no catálogo.`
          )
          await this.emailReader.markAsProcessed(email.id)
          processedCount++
          continue
        }

        // 2. Deduplica e sincroniza no Issue Tracker com checagem de Guardrails
        const syncResult = await this.deduplicateUseCase.execute(project, decision, email)

        if (syncResult.action === 'skipped_guardrail') {
          console.warn(
            `[Guardrail] Ação ignorada no projeto ${project.name}: ${syncResult.reason}`
          )
          await this.emailReader.markAsProcessed(email.id)
          processedCount++
          continue
        }

        // 3. Notifica por email
        const isUpdate = syncResult.action === 'updated'
        const subjectPrefix = isUpdate ? '[Ocorrência Adicional]' : '[Novo Ticket]'
        const cardUrl = syncResult.url || '#'

        await this.emailSender.sendEmail({
          to: [this.options.alertNotificationEmail],
          subject: `${subjectPrefix} [${project.name}] ${decision.ticketTitle}`,
          htmlBody: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; line-height: 1.5;">
              <h2 style="color: #0366d6;">
                ${isUpdate ? '🔁 Ocorrência Repetida Identificada' : '🎫 Novo Ticket Classificado por IA'}
              </h2>
              <p><strong>Projeto:</strong> ${project.name}</p>
              <p><strong>Confiança da IA:</strong> ${(decision.confidence * 100).toFixed(0)}%</p>
              <p><strong>Categoria:</strong> <span style="background: #eee; padding: 2px 6px; border-radius: 4px;">${decision.category}</span></p>
              <p><strong>Prioridade Atual:</strong> <span style="font-weight: bold; color: #d73a49;">${syncResult.priority}</span> (Ocorrências: ${syncResult.occurrences})</p>
              <p><strong>Link da Issue:</strong> <a href="${cardUrl}">${cardUrl}</a></p>
              <hr style="border: 0; border-top: 1px solid #e1e4e8; margin: 20px 0;"/>
              <p><strong>Justificativa da IA:</strong> <em>${decision.reasoning}</em></p>
              <p><strong>Corpo do Chamado:</strong></p>
              <div style="background: #f6f8fa; padding: 16px; border-radius: 6px; border: 1px solid #d0d7de; white-space: pre-wrap;">
${decision.ticketMarkdownBody}
              </div>
            </div>
          `,
        })

        console.info(
          `[Triage] Email processado com sucesso [ID: ${email.id}]. Ação tracker: ${syncResult.action}, Issue: ${syncResult.issueId}`
        )
        await this.emailReader.markAsProcessed(email.id)
        processedCount++
      } catch (err) {
        console.error(`[Triage] Erro ao processar email ID ${email.id}:`, err)
        // Não marcamos como lido para reprocessar ou inspecionar
      }
    }

    return { processedCount }
  }
}
