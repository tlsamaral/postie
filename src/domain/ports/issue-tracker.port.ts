export interface ExistingIssueSummary {
  id: string | number
  title: string
  body: string
  currentOccurrences: number
  currentPriority: string
  url: string
}

export interface CreateIssueInput {
  projectId: string
  title: string
  body: string
  priority: string
  occurrences: number
  labels: string[]
}

export interface UpdateIssueInput {
  projectId?: string
  issueId: string | number
  comment: string
  newOccurrences: number
  newPriority?: string
}

export interface IIssueTrackerPort {
  findOpenIssues(projectId: string): Promise<ExistingIssueSummary[]>
  createIssue(input: CreateIssueInput): Promise<{ id: string | number; url: string }>
  updateIssue(input: UpdateIssueInput): Promise<void>
}
