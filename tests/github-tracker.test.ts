import { describe, it, expect, vi } from 'vitest'
import { GitHubTrackerAdapter } from '../src/infrastructure/tracker/github-tracker.adapter.js'
import { ProjectDefinition } from '../src/domain/entities/project-definition.entity.js'

describe('GitHubTrackerAdapter', () => {
  const projectsCatalog: ProjectDefinition[] = [
    {
      id: 'test-project',
      name: 'Test Project',
      description: 'Desc',
      scopeBoundaries: ['Scope'],
      github: { owner: 'my-org', repo: 'my-repo' },
      allowedActions: ['create_issue', 'update_priority', 'comment'],
    },
  ]

  it('should format issue body and labels upon creation', async () => {
    const adapter = new GitHubTrackerAdapter({
      authToken: 'mock-token',
      projectsCatalog,
    })

    const mockCreate = vi.fn().mockResolvedValue({
      data: { number: 77, html_url: 'https://github.com/my-org/my-repo/issues/77' },
    })

    // @ts-expect-error Mocking octokit internal rest
    adapter.octokit.rest.issues.create = mockCreate

    const created = await adapter.createIssue({
      projectId: 'test-project',
      title: 'Erro 500 no checkout',
      body: 'Descrição detalhada do bug',
      priority: 'HIGH',
      occurrences: 1,
      labels: ['triage-agent', 'bug'],
    })

    expect(created.id).toBe(77)
    expect(created.url).toBe('https://github.com/my-org/my-repo/issues/77')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'my-org',
        repo: 'my-repo',
        title: 'Erro 500 no checkout',
        labels: expect.arrayContaining(['triage-agent', 'bug', 'priority:high']),
        body: expect.stringContaining('<!-- ticket-router-metadata: occurrences=1, priority=HIGH -->'),
      })
    )
  })

  it('should parse occurrences and priority from issue body and labels', async () => {
    const adapter = new GitHubTrackerAdapter({
      authToken: 'mock-token',
      projectsCatalog,
    })

    const mockList = vi.fn().mockResolvedValue({
      data: [
        {
          number: 10,
          title: 'Erro 500 no checkout',
          body: 'Desc\n<!-- ticket-router-metadata: occurrences=4, priority=CRITICAL -->',
          labels: ['priority:critical', 'bug'],
          html_url: 'https://github.com/my-org/my-repo/issues/10',
        },
      ],
    })

    // @ts-expect-error Mocking octokit internal rest
    adapter.octokit.rest.issues.listForRepo = mockList

    const issues = await adapter.findOpenIssues('test-project')

    expect(issues).toHaveLength(1)
    expect(issues[0].id).toBe(10)
    expect(issues[0].currentOccurrences).toBe(4)
    expect(issues[0].currentPriority).toBe('CRITICAL')
  })
})
