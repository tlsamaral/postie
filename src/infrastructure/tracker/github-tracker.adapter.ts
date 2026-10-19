import { Octokit } from '@octokit/rest'
import {
  IIssueTrackerPort,
  ExistingIssueSummary,
  CreateIssueInput,
  UpdateIssueInput,
} from '../../domain/ports/issue-tracker.port.js'
import { ProjectDefinition } from '../../domain/entities/project-definition.entity.js'

export interface GitHubTrackerAdapterOptions {
  authToken: string
  projectsCatalog: ProjectDefinition[]
}

export class GitHubTrackerAdapter implements IIssueTrackerPort {
  private readonly octokit: Octokit
  private readonly projectsCatalog: ProjectDefinition[]

  constructor(options: GitHubTrackerAdapterOptions) {
    this.octokit = new Octokit({ auth: options.authToken })
    this.projectsCatalog = options.projectsCatalog
  }

  private getProjectRepo(projectId: string): { owner: string; repo: string } {
    const project = this.projectsCatalog.find((p) => p.id === projectId)
    if (!project) {
      throw new Error(`Projeto "${projectId}" não foi encontrado no catálogo.`)
    }
    return project.github
  }

  async findOpenIssues(projectId: string): Promise<ExistingIssueSummary[]> {
    const { owner, repo } = this.getProjectRepo(projectId)

    const response = await this.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })

    return response.data
      // GitHub's issues endpoint returns both issues and pull requests; exclude PRs
      .filter((issue) => !issue.pull_request)
      .map((issue) => {
        const body = issue.body || ''
        const currentOccurrences = this.extractOccurrencesFromBody(body)
        const currentPriority = this.extractPriority(issue.labels, body)

        return {
          id: issue.number,
          title: issue.title,
          body,
          currentOccurrences,
          currentPriority,
          url: issue.html_url,
        }
      })
  }

  /**
   * Persists triage state (occurrences and priority) inside an HTML comment in the issue body,
   * keeping the agent stateless without requiring an external database.
   */
  async createIssue(input: CreateIssueInput): Promise<{ id: string | number; url: string }> {
    const { owner, repo } = this.getProjectRepo(input.projectId)

    const formattedBody = [
      input.body,
      '',
      '---',
      `<!-- ticket-router-metadata: occurrences=${input.occurrences}, priority=${input.priority} -->`,
      '**Origem:** Agente de Triagem Automática  ',
      `**Ocorrências relatadas:** ${input.occurrences}  `,
      `**Prioridade sugerida:** \`${input.priority}\``,
    ].join('\n')

    const labels = [...new Set([...input.labels, `priority:${input.priority.toLowerCase()}`])]

    const response = await this.octokit.rest.issues.create({
      owner,
      repo,
      title: input.title,
      body: formattedBody,
      labels,
    })

    return {
      id: response.data.number,
      url: response.data.html_url,
    }
  }

  async updateIssue(input: UpdateIssueInput): Promise<void> {
    if (!input.projectId) {
      throw new Error('projectId é obrigatório para atualizar issue no GitHub')
    }

    const { owner, repo } = this.getProjectRepo(input.projectId)
    const issueNumber = Number(input.issueId)

    if (input.comment && input.comment.trim().length > 0) {
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: input.comment,
      })
    }

    if (input.newOccurrences !== undefined || input.newPriority !== undefined) {
      const issueResp = await this.octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      })

      const currentBody = issueResp.data.body || ''
      const updatedBody = this.updateBodyOccurrences(
        currentBody,
        input.newOccurrences,
        input.newPriority
      )

      let updatedLabels = issueResp.data.labels.map((l) =>
        typeof l === 'string' ? l : l.name || ''
      )

      if (input.newPriority) {
        updatedLabels = updatedLabels.filter(
          (label) => !label.toLowerCase().startsWith('priority:')
        )
        updatedLabels.push(`priority:${input.newPriority.toLowerCase()}`)
      }

      await this.octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: updatedBody,
        labels: [...new Set(updatedLabels)],
      })
    }
  }

  private extractOccurrencesFromBody(body: string): number {
    const metaMatch = body.match(/<!--\s*ticket-router-metadata:.*?occurrences=(\d+)/i)
    if (metaMatch && metaMatch[1]) {
      return parseInt(metaMatch[1], 10)
    }

    const textMatch = body.match(/\*\*Ocorrências relatadas:\*\*\s*(\d+)/i)
    if (textMatch && textMatch[1]) {
      return parseInt(textMatch[1], 10)
    }

    return 1
  }

  private extractPriority(labels: any[], body: string): string {
    for (const label of labels) {
      const labelName = (typeof label === 'string' ? label : label.name || '').toLowerCase()
      if (labelName.startsWith('priority:')) {
        return labelName.replace('priority:', '').toUpperCase()
      }
      if (['low', 'medium', 'high', 'critical'].includes(labelName)) {
        return labelName.toUpperCase()
      }
    }

    const metaMatch = body.match(/<!--\s*ticket-router-metadata:.*?priority=([A-Z]+)/i)
    if (metaMatch && metaMatch[1]) {
      return metaMatch[1].toUpperCase()
    }

    return 'LOW'
  }

  private updateBodyOccurrences(
    body: string,
    occurrences: number,
    newPriority?: string
  ): string {
    let updated = body

    if (body.includes('<!-- ticket-router-metadata:')) {
      updated = updated.replace(
        /<!--\s*ticket-router-metadata:.*?-->/i,
        `<!-- ticket-router-metadata: occurrences=${occurrences}${
          newPriority ? `, priority=${newPriority}` : ''
        } -->`
      )
    }

    if (body.includes('**Ocorrências relatadas:**')) {
      updated = updated.replace(
        /\*\*Ocorrências relatadas:\*\*\s*\d+/i,
        `**Ocorrências relatadas:** ${occurrences}`
      )
    }

    return updated
  }
}
