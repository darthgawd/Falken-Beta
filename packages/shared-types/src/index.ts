import { z } from 'zod';

export const MatchStatusSchema = z.enum(['OPEN', 'ACTIVE', 'SETTLED', 'VOIDED']);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const PhaseSchema = z.enum(['COMMIT', 'REVEAL']);
export type Phase = z.infer<typeof PhaseSchema>;

export const MatchSchema = z.object({
  matchId: z.number(),
  playerA: z.string(),
  playerB: z.string().optional(),
  stake: z.string(), // BigInt as string
  gameLogic: z.string(),
  winsA: z.number(),
  winsB: z.number(),
  currentRound: z.number(),
  phase: PhaseSchema,
  status: MatchStatusSchema,
  commitDeadline: z.number(),
  revealDeadline: z.number(),
});

export type Match = z.infer<typeof MatchSchema>;

export const RoundCommitSchema = z.object({
  commitHash: z.string(),
  move: z.number().optional(),
  salt: z.string().optional(),
  revealed: z.boolean(),
});

export type RoundCommit = z.infer<typeof RoundCommitSchema>;
