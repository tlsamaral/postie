import { describe, it, expect } from 'vitest'
import { PriorityEngine } from '../src/domain/logic/priority-engine.js'

describe('PriorityEngine', () => {
  it('should normalize valid priorities case-insensitively', () => {
    expect(PriorityEngine.normalizePriority('low')).toBe('LOW')
    expect(PriorityEngine.normalizePriority('MEDIUM')).toBe('MEDIUM')
    expect(PriorityEngine.normalizePriority('high')).toBe('HIGH')
    expect(PriorityEngine.normalizePriority('critical')).toBe('CRITICAL')
  })

  it('should default unrecognized priorities to LOW', () => {
    expect(PriorityEngine.normalizePriority(undefined)).toBe('LOW')
    expect(PriorityEngine.normalizePriority('unknown')).toBe('LOW')
  })

  it('should not downgrade priority when suggested is lower than existing', () => {
    const priority = PriorityEngine.calculateEscalatedPriority('HIGH', 'LOW', 1)
    expect(priority).toBe('HIGH')
  })

  it('should escalate to HIGH when 3 or more occurrences are reached', () => {
    const priority = PriorityEngine.calculateEscalatedPriority('LOW', 'LOW', 3)
    expect(priority).toBe('HIGH')
  })

  it('should escalate to CRITICAL when 5 or more occurrences are reached', () => {
    const priority = PriorityEngine.calculateEscalatedPriority('LOW', 'LOW', 5)
    expect(priority).toBe('CRITICAL')
  })

  it('should respect suggested priority when higher than existing', () => {
    const priority = PriorityEngine.calculateEscalatedPriority('LOW', 'CRITICAL', 1)
    expect(priority).toBe('CRITICAL')
  })
})
