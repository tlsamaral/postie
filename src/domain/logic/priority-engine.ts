import { TicketPriority } from '../entities/routing-decision.entity.js'

const PRIORITY_RANK: Record<TicketPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

const RANK_TO_PRIORITY: Record<number, TicketPriority> = {
  1: 'LOW',
  2: 'MEDIUM',
  3: 'HIGH',
  4: 'CRITICAL',
}

export class PriorityEngine {
  /**
   * Normalizes any string representation of priority into TicketPriority.
   */
  public static normalizePriority(priority?: string): TicketPriority {
    if (!priority) return 'LOW'
    const upper = priority.toUpperCase().trim()
    if (upper in PRIORITY_RANK) {
      return upper as TicketPriority
    }
    return 'LOW'
  }

  /**
   * Dynamically escalates priority based on current priority, suggested priority from new incoming report,
   * and total occurrences count.
   *
   * Rules:
   * - Never downgrades an existing higher priority.
   * - 3 or more occurrences elevates priority to at least HIGH.
   * - 5 or more occurrences escalates priority to CRITICAL.
   * - Otherwise takes the max between current and suggested priority.
   */
  public static calculateEscalatedPriority(
    currentPriority: string | undefined,
    suggestedPriority: TicketPriority,
    totalOccurrences: number
  ): TicketPriority {
    const currentNorm = this.normalizePriority(currentPriority)
    const baseRank = Math.max(PRIORITY_RANK[currentNorm], PRIORITY_RANK[suggestedPriority])

    let occurrenceRank = 1
    if (totalOccurrences >= 5) {
      occurrenceRank = 4
    } else if (totalOccurrences >= 3) {
      occurrenceRank = 3
    } else if (totalOccurrences >= 2) {
      occurrenceRank = 2
    }

    const finalRank = Math.min(4, Math.max(baseRank, occurrenceRank))
    return RANK_TO_PRIORITY[finalRank]
  }
}
