'use client';

import React, { useMemo } from 'react';
// @ts-ignore
import TetrisDuel from '@/lib/tetris.js';

interface TetrisBoardProps {
  playerAddress: string;
  board: number[][]; // 20x10 array
  score: number;
  isWinner: boolean;
  playerName: string;
}

const PIECE_COLORS: Record<number, string> = {
  0: 'bg-transparent',
  1: 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]',   // I
  2: 'bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.5)]',   // J
  3: 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]', // L
  4: 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]', // O
  5: 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]',  // S
  6: 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]', // T
  7: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]',    // Z
  8: 'bg-zinc-600 border border-zinc-400 opacity-80',       // Garbage
};

export function TetrisBoard({ board, score, isWinner, playerName }: TetrisBoardProps) {
  // Flip the board for visual rendering (Row 0 is bottom)
  const visualRows = useMemo(() => [...board].reverse(), [board]);

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-700">
      {/* Player Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex flex-col">
          <span className={`text-xs font-black uppercase tracking-widest ${isWinner ? 'text-gold animate-pulse' : 'text-zinc-500'}`}>
            {isWinner ? '🏆_WINNER' : 'ARENA_COMBATANT'}
          </span>
          <span className="text-sm font-black text-white uppercase tracking-tighter truncate max-w-[140px]">
            {playerName}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">Score</span>
          <span className="text-base font-black text-blue-400 tabular-nums">{score.toLocaleString()}</span>
        </div>
      </div>

      {/* The 10x20 Grid */}
      <div className="relative p-1 bg-zinc-900 border-2 border-zinc-800 shadow-2xl">
        <div className="grid grid-cols-10 grid-rows-20 w-[240px] h-[480px] gap-0.5">
          {visualRows.map((row, y) => (
            row.map((cell, x) => (
              <div 
                key={`${x}-${y}`}
                className={`w-full h-full transition-all duration-300 ${PIECE_COLORS[cell] || 'bg-zinc-950/50'}`}
                style={{ 
                  borderWidth: cell !== 0 ? '1px' : '0px',
                  borderColor: 'rgba(255,255,255,0.1)'
                }}
              />
            ))
          ))}
        </div>

        {/* Tactical HUD Overlays */}
        <div className="absolute inset-0 pointer-events-none border border-blue-500/10" />
        <div className="absolute top-0 left-0 w-full h-[1px] bg-blue-500/20 animate-scanline" />
      </div>

      <style jsx>{`
        @keyframes scanline {
          0% { top: 0; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scanline {
          animation: scanline 4s linear infinite;
        }
      `}</style>
    </div>
  );
}

/**
 * Main Arena UI for Tetris
 */
export function TetrisArena({ match, rounds }: { match: any, rounds: any[] }) {
  // 1. Reconstruct full state from rounds
  const state = useMemo(() => {
    const logic = new TetrisDuel();
    const context = {
      playerA: match.player_a,
      playerB: match.player_b,
      seed: match.match_id,
      stake: BigInt(match.stake_wei || '0')
    };

    let s = logic.init(context);
    
    // Sort and apply all revealed moves
    const revealedMoves = rounds
      .filter(r => r.revealed)
      .sort((a, b) => a.round_number - b.round_number || a.player_index - b.player_index);

    for (const move of revealedMoves) {
      s = logic.processMove(s, {
        player: move.player_address,
        moveData: move.move,
        round: move.round_number
      });
    }
    return s;
  }, [match, rounds]);

  return (
    <div className="flex flex-col items-center gap-8 py-8 w-full">
      <div className="flex flex-col md:flex-row gap-12 items-start justify-center">
        {/* Board A */}
        <TetrisBoard 
          playerAddress={match.player_a}
          board={state.boardA}
          score={state.scoreA}
          isWinner={state.winner === 1}
          playerName={match.player_a_nickname || 'Player_A'}
        />

        {/* VS Divider */}
        <div className="hidden md:flex flex-col items-center justify-center h-[480px]">
          <div className="h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-800 to-transparent" />
          <div className="px-3 py-1 bg-zinc-900 border border-zinc-800 text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] rotate-90">
            STAKES_ON_CHAIN
          </div>
          <div className="h-full w-[1px] bg-gradient-to-b from-transparent via-zinc-800 to-transparent" />
        </div>

        {/* Board B */}
        <TetrisBoard 
          playerAddress={match.player_b}
          board={state.boardB}
          score={state.scoreB}
          isWinner={state.winner === 2}
          playerName={match.player_b_nickname || 'Player_B'}
        />
      </div>

      {/* Match Status HUD */}
      <div className="w-full max-w-2xl p-6 bg-zinc-950 border border-zinc-900 rounded-none flex items-center justify-between font-arena shadow-2xl">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Piece_Queue</p>
          <div className="flex gap-2">
            {state.pieceBag.slice(state.currentPieceIndex, state.currentPieceIndex + 5).map((p: string, i: number) => (
              <div key={i} className="w-8 h-8 bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[10px] font-black text-blue-400">
                {p}
              </div>
            ))}
          </div>
        </div>
        
        <div className="text-right">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Match_Status</p>
          <p className={`text-sm font-black uppercase italic ${state.gameOver ? 'text-gold' : 'text-emerald-500'}`}>
            {state.gameOver ? 'TRANSACTION_SETTLED' : 'MONITORING_REASONING...'}
          </p>
        </div>
      </div>
    </div>
  );
}
