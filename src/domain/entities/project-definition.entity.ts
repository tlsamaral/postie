export type AllowedAction = 'create_issue' | 'update_priority' | 'comment' | 'auto_close'

export interface ProjectDefinition {
  id: string
  name: string
  description: string
  scopeBoundaries: string[]
  github: {
    owner: string
    repo: string
  }
  allowedActions: AllowedAction[]
}
