import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'
import { RoutingDecision } from '../../domain/entities/routing-decision.entity.js'
import { RawEmailMessage } from '../../domain/ports/email-reader.port.js'
import { IIssueTrackerPort, ExistingIssueSummary } from '../../domain/ports/issue-tracker.port.js'
import { PriorityEngine } from '../../domain/logic/priority-engine.js'

export interface SyncIssueResult {
  action: 'created' | 'updated' | 'skipped_guardrail'
  issueId?: string | number
  url?: string
  occurrences: number
  priority: string
  reason?: string
}

export class DeduplicateAndSyncIssueUseCase {
  constructor(private readonly issueTracker: IIssueTrackerPort) {}

  public async execute(
    project: ProjectDefinition,
    decision: RoutingDecision,
    email: RawEmailMessage
  ): Promise<SyncIssueResult> {
    const openIssues = await this.issueTracker.findOpenIssues(project.id)

    const matchingIssue = this.findMatchingIssue(decision.ticketTitle, openIssues)

    if (matchingIssue) {
      return this.handleDuplicateIssue(project, decision, email, matchingIssue)
    }

    return this.handleNewIssue(project, decision)
  }

  /**
   * Matches candidate issue by title token similarity.
   */
  private findMatchingIssue(
    targetTitle: string,
    existingIssues: ExistingIssueSummary[]
  ): ExistingIssueSummary | null {
    if (!existingIssues || existingIssues.length === 0) return null

    const targetTokens = this.tokenize(targetTitle)
    if (targetTokens.size === 0) return null

    let bestMatch: ExistingIssueSummary | null = null
    let highestScore = 0

    for (const issue of existingIssues) {
      const issueTokens = this.tokenize(issue.title)
      if (issueTokens.size === 0) continue

      const score = this.calculateJaccardSimilarity(targetTokens, issueTokens)

      // Se similaridade de tokens for >= 0.50 ou um for substring normalizada do outro
      const normalizedTarget = targetTitle.toLowerCase().trim()
      const normalizedIssue = issue.title.toLowerCase().trim()
      const isSubstring =
        normalizedTarget.includes(normalizedIssue) || normalizedIssue.includes(normalizedTarget)

      if (score >= 0.5 || (isSubstring && normalizedTarget.length > 8 && normalizedIssue.length > 8)) {
        if (score > highestScore || isSubstring) {
          highestScore = Math.max(score, isSubstring ? 0.7 : score)
          bestMatch = issue
        }
      }
    }

    return highestScore >= 0.5 ? bestMatch : null
  }

  private tokenize(text: string): Set<string> {
    const stopwords = new Set([
      'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'nao', 'uma',
      'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele',
      'the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'for', 'with', 'to'
    ])

    const words = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w))

    return new Set(words)
  }

  private calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    let intersectionCount = 0
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionCount++
      }
    }
    const unionCount = new Set([...setA, ...setB]).size
    return unionCount === 0 ? 0 : intersectionCount / unionCount
  }

  private async handleDuplicateIssue(
    project: ProjectDefinition,
    decision: RoutingDecision,
    email: RawEmailMessage,
    existingIssue: ExistingIssueSummary
  ): Promise<SyncIssueResult> {
    const canComment = project.allowedActions.includes('comment')
    const canUpdatePriority = project.allowedActions.includes('update_priority')

    if (!canComment && !canUpdatePriority) {
      return {
        action: 'skipped_guardrail',
        issueId: existingIssue.id,
        url: existingIssue.url,
        occurrences: existingIssue.currentOccurrences,
        priority: existingIssue.currentPriority,
        reason: `Projeto ${project.name} não permite ações 'comment' nem 'update_priority'`,
      }
    }

    const newOccurrences = (existingIssue.currentOccurrences || 1) + 1
    const newPriority = PriorityEngine.calculateEscalatedPriority(
      existingIssue.currentPriority,
      decision.suggestedPriority,
      newOccurrences
    )

    const priorityChanged = newPriority !== existingIssue.currentPriority && canUpdatePriority

    const comment = [
      '### 🔄 Nova ocorrência reportada via email',
      '',
      `- **Remetente:** \`${email.from.address}\``,
      `- **Recebido em:** ${email.receivedAt.toISOString()}`,
      `- **Assunto Original:** ${email.subject}`,
      `- **Total de Ocorrências:** ${newOccurrences}`,
      `- **Prioridade Sugerida pela IA:** ${decision.suggestedPriority}`,
      priorityChanged
        ? `- **Prioridade Escalada:** \`${existingIssue.currentPriority}\` ➡️ **\`${newPriority}\`**`
        : `- **Prioridade Atual:** \`${existingIssue.currentPriority}\``,
      '',
      '#### Detalhes do Relato:',
      decision.ticketMarkdownBody,
    ].join('\n')

    await this.issueTracker.updateIssue({
      projectId: project.id,
      issueId: existingIssue.id,
      comment: canComment ? comment : '',
      newOccurrences,
      newPriority: priorityChanged ? newPriority : undefined,
    })

    return {
      action: 'updated',
      issueId: existingIssue.id,
      url: existingIssue.url,
      occurrences: newOccurrences,
      priority: priorityChanged ? newPriority : existingIssue.currentPriority,
    }
  }

  private async handleNewIssue(
    project: ProjectDefinition,
    decision: RoutingDecision
  ): Promise<SyncIssueResult> {
    if (!project.allowedActions.includes('create_issue')) {
      return {
        action: 'skipped_guardrail',
        occurrences: 0,
        priority: decision.suggestedPriority,
        reason: `Ação 'create_issue' não permitida no projeto ${project.name}`,
      }
    }

    const created = await this.issueTracker.createIssue({
      projectId: project.id,
      title: decision.ticketTitle,
      body: decision.ticketMarkdownBody,
      priority: decision.suggestedPriority,
      occurrences: 1,
      labels: ['triage-agent', decision.category.toLowerCase()],
    })

    return {
      action: 'created',
      issueId: created.id,
      url: created.url,
      occurrences: 1,
      priority: decision.suggestedPriority,
    }
  }
}
