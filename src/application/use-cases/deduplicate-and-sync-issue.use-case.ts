import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'
import { RoutingDecision, IAIRouterPort } from '../../domain/ports/ai-router.port.js'
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
  constructor(
    private readonly issueTracker: IIssueTrackerPort,
    private readonly aiRouter?: IAIRouterPort
  ) {}

  public async execute(
    project: ProjectDefinition,
    decision: RoutingDecision,
    email: RawEmailMessage
  ): Promise<SyncIssueResult> {
    const openIssues = await this.issueTracker.findOpenIssues(project.id)

    const matchingIssue = await this.findMatchingIssue(decision, openIssues, project)

    if (matchingIssue) {
      return this.handleDuplicateIssue(project, decision, email, matchingIssue)
    }

    return this.handleNewIssue(project, decision)
  }

  /**
   * Two-stage deduplication pipeline:
   * 1. Domain-aware lexical pre-filter (Jaccard similarity excluding project-specific tokens)
   * 2. Semantic root-cause verification via LLM to prevent false-positive clustering within the same module
   */
  private async findMatchingIssue(
    decision: RoutingDecision,
    existingIssues: ExistingIssueSummary[],
    project: ProjectDefinition
  ): Promise<ExistingIssueSummary | null> {
    if (!existingIssues || existingIssues.length === 0) return null

    const domainStopwords = this.extractDomainStopwords(project)

    const targetTokens = this.tokenize(decision.ticketTitle, domainStopwords)
    if (targetTokens.size === 0) return null

    let candidateIssue: ExistingIssueSummary | null = null
    let highestScore = 0

    for (const issue of existingIssues) {
      const issueTokens = this.tokenize(issue.title, domainStopwords)
      if (issueTokens.size === 0) continue

      const score = this.calculateJaccardSimilarity(targetTokens, issueTokens)
      const sharedCount = this.countSharedTokens(targetTokens, issueTokens)

      const normalizedTarget = decision.ticketTitle.toLowerCase().trim()
      const normalizedIssue = issue.title.toLowerCase().trim()
      const isSubstring =
        normalizedTarget.includes(normalizedIssue) || normalizedIssue.includes(normalizedTarget)

      const isCandidate =
        score >= 0.25 ||
        sharedCount >= 2 ||
        (isSubstring && normalizedTarget.length > 8 && normalizedIssue.length > 8)

      if (isCandidate) {
        const compositeScore = Math.max(score, sharedCount * 0.2, isSubstring ? 0.7 : 0)
        if (compositeScore > highestScore) {
          highestScore = compositeScore
          candidateIssue = issue
        }
      }
    }

    if (!candidateIssue) {
      return null
    }

    if (this.aiRouter?.verifyDuplicate) {
      console.info(
        `[Deduplication] Candidato léxico encontrado (Issue #${candidateIssue.id}: "${candidateIssue.title}"). Verificando semanticamente com a IA...`
      )
      const verifyRes = await this.aiRouter.verifyDuplicate(
        {
          title: decision.ticketTitle,
          description: decision.ticketMarkdownBody,
        },
        candidateIssue
      )

      if (!verifyRes.isDuplicate) {
        console.info(
          `[Deduplication] IA determinou que os chamados tratam de problemas técnicos distintos. Criando nova issue separada. Justificativa: ${verifyRes.reasoning}`
        )
        return null
      }

      console.info(
        `[Deduplication] IA confirmou reincidência técnica na Issue #${candidateIssue.id}: ${verifyRes.reasoning}`
      )
    }

    return candidateIssue
  }

  private extractDomainStopwords(project: ProjectDefinition): Set<string> {
    const rawTerms = [
      project.id,
      project.name,
      project.github.repo,
      project.github.owner,
    ].join(' ')

    const terms = rawTerms
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => this.stem(w))

    return new Set(terms)
  }

  private countSharedTokens(setA: Set<string>, setB: Set<string>): number {
    let count = 0
    for (const item of setA) {
      if (setB.has(item)) count++
    }
    return count
  }

  private stem(word: string): string {
    let w = word
    if (w.endsWith('ens')) return w.slice(0, -3) + 'em'
    if (w.endsWith('ais')) return w.slice(0, -3) + 'al'
    if (w.endsWith('eis')) return w.slice(0, -3) + 'el'
    if (w.endsWith('oes')) return w.slice(0, -3) + 'ao'
    if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
    return w
  }

  private tokenize(text: string, extraStopwords?: Set<string>): Set<string> {
    const stopwords = new Set([
      'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'nao', 'uma',
      'os', 'no', 'nos', 'na', 'nas', 'se', 'por', 'mais', 'as', 'dos', 'das', 'como', 'mas', 'ao', 'aos', 'ele',
      'pelo', 'pela', 'pelos', 'pelas', 'qual', 'quais', 'sua', 'seu', 'suas', 'seus', 'este', 'esta', 'esse', 'essa',
      'the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'for', 'with', 'to'
    ])

    const words = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w) && (!extraStopwords || !extraStopwords.has(w)))
      .map((w) => this.stem(w))

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
