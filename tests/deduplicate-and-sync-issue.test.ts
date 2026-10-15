import { describe, it, expect, vi } from 'vitest'
import { DeduplicateAndSyncIssueUseCase } from '../src/application/use-cases/deduplicate-and-sync-issue.use-case.js'
import { IIssueTrackerPort, ExistingIssueSummary } from '../src/domain/ports/issue-tracker.port.js'
import { ProjectDefinition } from '../src/domain/entities/project-definition.entity.js'
import { RoutingDecision } from '../src/domain/entities/routing-decision.entity.js'
import { RawEmailMessage } from '../src/domain/ports/email-reader.port.js'

describe('DeduplicateAndSyncIssueUseCase', () => {
  const mockProject: ProjectDefinition = {
    id: 'portal-cliente',
    name: 'Portal do Cliente',
    description: 'Pedidos e faturas de clientes',
    scopeBoundaries: ['Pertence: segunda via de boleto'],
    github: { owner: 'minha-organizacao', repo: 'portal-cliente' },
    allowedActions: ['create_issue', 'update_priority', 'comment'],
  }

  const sampleEmail: RawEmailMessage = {
    id: 'msg-1',
    subject: 'Erro ao emitir segunda via do boleto',
    from: { name: 'João', address: 'joao@cliente.com' },
    receivedAt: new Date('2026-03-10T10:00:00Z'),
    bodyText: 'Não consigo emitir a segunda via do boleto no portal.',
    attachmentsCount: 0,
  }

  const decision: RoutingDecision = {
    matchedProjectId: 'portal-cliente',
    confidence: 0.95,
    reasoning: 'Relato sobre emissão de segunda via do boleto',
    category: 'BUG',
    ticketTitle: 'Falha ao emitir segunda via do boleto no portal',
    ticketMarkdownBody: 'Usuário não consegue emitir a segunda via.',
    suggestedPriority: 'MEDIUM',
  }

  it('should create a new issue when no duplicate exists', async () => {
    const mockTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn().mockResolvedValue([]),
      createIssue: vi.fn().mockResolvedValue({ id: 101, url: 'https://github.com/issue/101' }),
      updateIssue: vi.fn().mockResolvedValue(undefined),
    }

    const useCase = new DeduplicateAndSyncIssueUseCase(mockTracker)
    const result = await useCase.execute(mockProject, decision, sampleEmail)

    expect(result.action).toBe('created')
    expect(result.issueId).toBe(101)
    expect(result.occurrences).toBe(1)
    expect(mockTracker.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'portal-cliente',
        title: decision.ticketTitle,
        priority: 'MEDIUM',
        occurrences: 1,
      })
    )
  })

  it('should detect duplicate issue, increment occurrences and comment', async () => {
    const existingIssue: ExistingIssueSummary = {
      id: 42,
      title: 'Falha ao emitir segunda via do boleto no portal',
      body: 'Descrição anterior',
      currentOccurrences: 2,
      currentPriority: 'MEDIUM',
      url: 'https://github.com/issue/42',
    }

    const mockTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn().mockResolvedValue([existingIssue]),
      createIssue: vi.fn(),
      updateIssue: vi.fn().mockResolvedValue(undefined),
    }

    const useCase = new DeduplicateAndSyncIssueUseCase(mockTracker)
    const result = await useCase.execute(mockProject, decision, sampleEmail)

    expect(result.action).toBe('updated')
    expect(result.issueId).toBe(42)
    expect(result.occurrences).toBe(3)
    // 3 occurrences escalates to HIGH
    expect(result.priority).toBe('HIGH')
    expect(mockTracker.updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 42,
        newOccurrences: 3,
        newPriority: 'HIGH',
      })
    )
  })

  it('should respect guardrails when project does not allow create_issue', async () => {
    const restrictedProject: ProjectDefinition = {
      ...mockProject,
      allowedActions: ['comment'],
    }

    const mockTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn().mockResolvedValue([]),
      createIssue: vi.fn(),
      updateIssue: vi.fn(),
    }

    const useCase = new DeduplicateAndSyncIssueUseCase(mockTracker)
    const result = await useCase.execute(restrictedProject, decision, sampleEmail)

    expect(result.action).toBe('skipped_guardrail')
    expect(mockTracker.createIssue).not.toHaveBeenCalled()
  })

  it('should respect guardrails when project does not allow comment or update_priority on duplicate', async () => {
    const restrictedProject: ProjectDefinition = {
      ...mockProject,
      allowedActions: ['create_issue'], // neither comment nor update_priority
    }

    const existingIssue: ExistingIssueSummary = {
      id: 55,
      title: 'Falha ao emitir segunda via do boleto no portal',
      body: 'Desc',
      currentOccurrences: 1,
      currentPriority: 'LOW',
      url: 'https://github.com/issue/55',
    }

    const mockTracker: IIssueTrackerPort = {
      findOpenIssues: vi.fn().mockResolvedValue([existingIssue]),
      createIssue: vi.fn(),
      updateIssue: vi.fn(),
    }

    const useCase = new DeduplicateAndSyncIssueUseCase(mockTracker)
    const result = await useCase.execute(restrictedProject, decision, sampleEmail)

    expect(result.action).toBe('skipped_guardrail')
    expect(mockTracker.updateIssue).not.toHaveBeenCalled()
  })
})
