export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      matches: {
        Row: {
          match_id: number
          player_a: string
          player_b: string | null
          stake_wei: string
          game_logic: string
          wins_a: number
          wins_b: number
          current_round: number
          phase: string
          status: string
          commit_deadline: string | null
          reveal_deadline: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          match_id: number
          player_a: string
          player_b?: string | null
          stake_wei: string
          game_logic: string
          wins_a?: number
          wins_b?: number
          current_round?: number
          phase?: string
          status?: string
          commit_deadline?: string | null
          reveal_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          match_id?: number
          player_a?: string
          player_b?: string | null
          stake_wei?: string
          game_logic?: string
          wins_a?: number
          wins_b?: number
          current_round?: number
          phase?: string
          status?: string
          commit_deadline?: string | null
          reveal_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      rounds: {
        Row: {
          match_id: number
          round_number: number
          player_address: string
          commit_hash: string | null
          move: number | null
          salt: string | null
          revealed: boolean
        }
        Insert: {
          match_id: number
          round_number: number
          player_address: string
          commit_hash?: string | null
          move?: number | null
          salt?: string | null
          revealed?: boolean
        }
        Update: {
          match_id?: number
          round_number?: number
          player_address?: string
          commit_hash?: string | null
          move?: number | null
          salt?: string | null
          revealed?: boolean
        }
      }
    }
  }
}
