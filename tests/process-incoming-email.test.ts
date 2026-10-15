import { describe, it, expect, vi } from 'vitest'
import { ProcessIncomingEmailUseCase } from '../src/application/use-cases/process-incoming-email.use-case.js'
import { IEmailReaderPort, RawEmailMessage } from '../src/domain/ports/email-reader.port.js'
import { IEmailSenderPort } from '../src/domain/ports/email-sender.port.js'
import { IAIRouterPort, RoutingDecision } from '../src/domain/ports/ai-router.port.js'
import { IIssueTrackerPort } from '../src/domain/ports/issue-tracker.port.js'
import { ProjectDefinition } from '../src/domain/entities/project-definition.entity.js'

describe('ProcessIncomingEmailUseCase', () => {
  const catalog: ProjectDefinition[] = [
    {
      id: 'erp-integrador',
      name: 'Integrador ERP',
      description: 'Sincronização de pedidos e financeiro com o ERP',
      scopeBoundaries: ['Pertence: falhas de webhook, sincronia de boletos'],
      github: { owner: 'minha-organizacao', repo: 'erp-sync-service' },
      allowedActions: ['create_issue'],
    },
  ]

  const mockEmail: RawEmailMessage = {
    id: 'msg-99',
    subject: 'Boleto não sincronizado no ERP',
    from: { name: 'Financeiro', address: 'financeiro@empresa.com' },
    receivedAt: new Date(),
    bodyText: 'O boleto 12345 não integrou no ERP hoje cedo.',
    attachmentsCount: 0,
  }

  it('should triage, create issue, send notification and mark email as processed', async () => {
    const mockEmailReader: IEmailReaderPort = {
      fetchUnreadMessages: vi.fn().mockResolvedValue([mockEmail]),
      markAsProcessed: vi.fn().mockResolvedValue(undefined),
    }

    const mockEmailSender: IEmailSenderPort = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    }

    const mockAIRouter: IAIRouterPort = {
      classifyAndRoute: vi.fn().mockResolvedValue({
        matchedProjectId: 'erp-integrador',
        confidence: 0.98,
        reasoning: 'Problema com sincronia de boleto no RM',
        category: 'BUG',
        ticketTitle: 'Falha na sincronização de boleto no ERP RM',
        ticketMarkdownBody: 'Boleto 12345 não integrou.',
        suggestedPriority: 'HIGH',
      } as RoutingDecision),
    }

    const mockIssueTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn().mockResolvedValue([]),
      createIssue: vi.fn().mockResolvedValue({ id: 200, url: 'https://github.com/issue/200' }),
      updateIssue: vi.fn(),
    }

    const useCase = new ProcessIncomingEmailUseCase(
      mockEmailReader,
      mockEmailSender,
      mockAIRouter,
      mockIssueTracker,
      catalog,
      { alertNotificationEmail: 'alerta@empresa.com' }
    )

    const result = await useCase.execute()

    expect(result.processedCount).toBe(1)
    expect(mockAIRouter.classifyAndRoute).toHaveBeenCalledWith(mockEmail, catalog)
    expect(mockIssueTracker.createIssue).toHaveBeenCalled()
    expect(mockEmailSender.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['alerta@empresa.com'],
        subject: expect.stringContaining('[Novo Ticket] [Integrador ERP]'),
      })
    )
    expect(mockEmailReader.markAsProcessed).toHaveBeenCalledWith('msg-99')
  })

  it('should mark out-of-scope email as processed without creating issue or sending alert', async () => {
    const mockEmailReader: IEmailReaderPort = {
      fetchUnreadMessages: vi.fn().mockResolvedValue([mockEmail]),
      markAsProcessed: vi.fn().mockResolvedValue(undefined),
    }

    const mockEmailSender: IEmailSenderPort = {
      sendEmail: vi.fn(),
    }

    const mockAIRouter: IAIRouterPort = {
      classifyAndRoute: vi.fn().mockResolvedValue({
        matchedProjectId: null, // Out of scope / spam
        confidence: 0.1,
        reasoning: 'Propaganda / fora de escopo',
        category: 'SPAM',
        ticketTitle: '',
        ticketMarkdownBody: '',
        suggestedPriority: 'LOW',
      } as RoutingDecision),
    }

    const mockIssueTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn(),
      createIssue: vi.fn(),
      updateIssue: vi.fn(),
    }

    const useCase = new ProcessIncomingEmailUseCase(
      mockEmailReader,
      mockEmailSender,
      mockAIRouter,
      mockIssueTracker,
      catalog,
      { alertNotificationEmail: 'alerta@empresa.com' }
    )

    const result = await useCase.execute()

    expect(result.processedCount).toBe(1)
    expect(mockIssueTracker.createIssue).not.toHaveBeenCalled()
    expect(mockEmailSender.sendEmail).not.toHaveBeenCalled()
    expect(mockEmailReader.markAsProcessed).toHaveBeenCalledWith('msg-99')
  })
})
