'use client';

import React from 'react';

interface CardDisplayProps {
  cardId: number;
  isDiscarded?: boolean;
}

export const CardDisplay = ({ cardId, isDiscarded = false }: CardDisplayProps) => {
  if (cardId === -1) {
    // Face down card
    return (
      <div className="w-12 h-18 sm:w-16 sm:h-24 rounded-lg sm:rounded-xl border border-zinc-700 bg-zinc-900 flex items-center justify-center relative shadow-xl shadow-black/80 overflow-hidden">
        <div className="absolute inset-1 rounded-md bg-blue-900/20 border border-blue-500/20 flex items-center justify-center">
            <div className="w-full h-full opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #3b82f6 1px, transparent 1px)', backgroundSize: '4px 4px' }} />
            <span className="text-blue-500/40 text-xs font-black rotate-45 tracking-widest">FALKEN</span>
        </div>
      </div>
    );
  }

  const suits = ['♣', '♦', '♥', '♠']; // 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
  const suitColors = { '♣': 'text-zinc-400', '♦': 'text-blue-500', '♥': 'text-red-500', '♠': 'text-zinc-100' };
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  const suit = suits[Math.floor(cardId / 13)];
  const rank = ranks[cardId % 13];
  const color = suitColors[suit as keyof typeof suitColors];

  return (
    <div className={`w-12 h-18 sm:w-16 sm:h-24 rounded-lg sm:rounded-xl border bg-zinc-950 flex flex-col items-center justify-center relative transition-all duration-500 ${isDiscarded ? 'opacity-30 border-dashed border-zinc-800' : 'border-zinc-700 shadow-xl shadow-black/80'}`}>
      <span className={`text-base sm:text-xl font-black leading-none mb-0.5 sm:mb-1 ${isDiscarded ? 'text-zinc-800' : 'text-white'}`}>{rank}</span>
      <span className={`text-lg sm:text-2xl ${isDiscarded ? 'text-zinc-800' : color}`}>{suit}</span>
      {isDiscarded && <div className="absolute inset-0 flex items-center justify-center"><div className="w-full h-[2px] bg-red-500/40 rotate-45" /></div>}
    </div>
  );
};

const HAND_LABELS = [
  "High Card", "Pair", "Two Pair", "Three of a Kind", 
  "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"
];

interface PokerTableProps {
  matchId: string;
  playerA: string;
  playerB: string;
  round: number;
  logicId: string;
  playerAMove?: number | string;
  playerBMove?: number | string;
  playerASalt?: string;
  playerBSalt?: string;
  playerANickname?: string;
  playerBNickname?: string;
  isShowdown?: boolean;
  winner?: number; // 0=Draw, 1=A, 2=B
}

export const PokerTable = ({
  matchId,
  playerA,
  playerB,
  round,
  logicId,
  playerAMove,
  playerBMove,
  playerASalt,
  playerBSalt,
  playerANickname,
  playerBNickname,
  isShowdown = false,
  winner
}: PokerTableProps) => {
  // 1. Generate deck identically to poker.js
  const generateDeck = (seedStr: string) => {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      hash = (Math.imul(1664525, hash) + 1013904223) | 0;
      const j = Math.abs(hash % (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  };

  const getHandRank = (hand: number[]) => {
    const ranks = hand.map(c => c % 13).sort((a, b) => b - a);
    const suits = hand.map(c => Math.floor(c / 13));
    const counts: Record<number, number> = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    const sortedCounts = Object.entries(counts)
      .map(([rank, count]) => [Number(rank), count])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const isFlush = new Set(suits).size === 1;
    let isStraight = ranks.every((r, i) => i === 0 || ranks[i-1] - r === 1);
    if (!isStraight && ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0) isStraight = true;

    if (isStraight && isFlush) return 8;
    if (sortedCounts[0][1] === 4) return 7;
    if (sortedCounts[0][1] === 3 && sortedCounts[1][1] === 2) return 6;
    if (isFlush) return 5;
    if (isStraight) return 4;
    if (sortedCounts[0][1] === 3) return 3;
    if (sortedCounts[0][1] === 2 && sortedCounts[1][1] === 2) return 2;
    if (sortedCounts[0][1] === 2) return 1;
    return 0;
  };

  const cleanLogicId = logicId.toLowerCase();
  const pokerLogicIdV4 = '0x6de9e3cf14c5a06e9e46ade75679a7e6e49f4f9f96bd873e5166cf276ccf0233';
  
  // Game logic uses FULL matchId + "_" + round as seed (lowercase)
  // Must match bot's computeHand: (matchId + "_" + round).toLowerCase()
  const seed = (matchId + "_" + round).toLowerCase();
  
  const isPoker = cleanLogicId === pokerLogicIdV4;

  const deck = generateDeck(seed);

  // Show cards if move data is available (decoded move or bytes32)
  // This allows viewing cards as soon as a player reveals, even if opponent hasn't
  const hasMoveA = playerAMove !== undefined && playerAMove !== null;
  const hasMoveB = playerBMove !== undefined && playerBMove !== null;
  
  // For the current round display (isShowdown=false), still show cards if moves exist
  // This helps debug and view partial reveals
  const showA = hasMoveA;
  const showB = hasMoveB;

  // Bitmask decode helper: extract set bit positions as discard indices
  const bitmaskToIndices = (move: number | string | undefined | null): number[] => {
    const val = Number(move);
    if (!val || val === 99) return [];
    const indices: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (val & (1 << i)) indices.push(i);
    }
    return indices;
  };

  // Player A Hand
  const initialHandA = deck.slice(0, 5);
  const discardIndicesA = bitmaskToIndices(playerAMove);
  let finalHandA = [...initialHandA];
  discardIndicesA.forEach((idx, i) => { if (idx >= 0 && idx < 5) finalHandA[idx] = deck[10 + i]; });
  const handRankA = getHandRank(finalHandA);

  // Player B Hand
  const initialHandB = deck.slice(5, 10);
  const discardIndicesB = bitmaskToIndices(playerBMove);
  let finalHandB = [...initialHandB];
  discardIndicesB.forEach((idx, i) => { if (idx >= 0 && idx < 5) finalHandB[idx] = deck[15 + i]; });
  const handRankB = getHandRank(finalHandB);

  return (
    <div className="relative w-full max-w-4xl mx-auto aspect-[16/12] sm:aspect-[16/10] my-8 font-arena overflow-hidden sm:overflow-visible">
      {/* Wood Rail / Border */}
      <div className="absolute inset-0 rounded-[40px] sm:rounded-[100px] border-[8px] sm:border-[16px] border-zinc-800 shadow-2xl bg-zinc-900" />
      
      {/* Felt background */}
      <div className="absolute inset-[8px] sm:inset-[16px] rounded-[32px] sm:rounded-[84px] bg-gradient-to-b from-[#3d7a4d] via-[#2d5a3d] to-[#1a3d2e] overflow-hidden">
        {/* Subtle Felt Texture */}
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/felt.png")' }} />
        
        {/* Player B Area (Top) */}
        <div className="absolute top-[6%] left-1/2 -translate-x-1/2 flex flex-col items-center w-full px-4">
          <div className="mb-2 sm:mb-4 flex flex-col items-center">
            <div className={`backdrop-blur-md border px-3 sm:px-4 py-1 rounded-full text-white font-bold text-xs sm:text-sm ${playerB === 'WAITING' || playerBNickname === 'WAITING...' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400' : 'bg-black/40 border-white/10'}`}>
              {playerBNickname || playerB?.slice(0, 6) || 'Unknown'}
            </div>
            {(playerB === 'WAITING' || playerBNickname === 'WAITING...') && (
              <div className="mt-1 text-[8px] sm:text-[10px] font-black text-yellow-500 uppercase tracking-widest bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 animate-pulse">
                WAITING TO JOIN
              </div>
            )}
            {showB && (
              <div className="mt-1 flex flex-col items-center gap-1">
                <div className="text-[8px] sm:text-[10px] font-black text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                  {HAND_LABELS[handRankB]}
                </div>
                {discardIndicesB.length > 0 && (
                  <span className="text-[7px] sm:text-[9px] font-black text-white/30 uppercase tracking-[0.1em] italic">
                    {discardIndicesB.length} {discardIndicesB.length === 1 ? 'CARD' : 'CARDS'} SWAPPED
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-1 sm:gap-2">
            {finalHandB.map((card, i) => (
              <CardDisplay key={i} cardId={showB ? card : -1} />
            ))}
          </div>
        </div>

        {/* Winner Announcement - Positioned between hands */}
        {winner !== null && winner !== undefined && isShowdown && (
          <div className="absolute top-[54%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 animate-in fade-in zoom-in duration-700 w-full flex justify-center">
            <div className={`px-6 py-2 rounded-full border backdrop-blur-md shadow-2xl ${
              winner === 1 ? 'bg-gold/20 border-gold/40 text-gold' :
              winner === 2 ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' :
              'bg-zinc-500/20 border-zinc-500/40 text-zinc-400'
            }`}>
              <span className="text-xs sm:text-sm font-black uppercase tracking-[0.3em] italic">
                {winner === 1 ? `${playerANickname || 'PLAYER A'} WON` :
                 winner === 2 ? `${playerBNickname || 'PLAYER B'} WON` :
                 'DRAW / SPLIT'}
              </span>
            </div>
          </div>
        )}

        {/* Center Table Decorations */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="flex -space-x-4 opacity-10 grayscale">
            <div className="w-8 h-12 rounded border border-white/20 bg-white/5 rotate-[-15deg]" />
            <div className="w-8 h-12 rounded border border-white/20 bg-white/5 rotate-[5deg]" />
            <div className="w-8 h-12 rounded border border-white/20 bg-white/5 rotate-[20deg]" />
          </div>
        </div>

        {/* Player A Area (Bottom) */}
        <div className="absolute bottom-[6%] left-1/2 -translate-x-1/2 flex flex-col items-center w-full px-4">
          <div className="flex gap-1 sm:gap-2 mb-2 sm:mb-4">
            {finalHandA.map((card, i) => (
              <CardDisplay key={i} cardId={showA ? card : -1} />
            ))}
          </div>
          <div className="flex flex-col items-center">
            <div className="mb-1 flex flex-col items-center gap-1">
              {showA && (
                <div className="text-[8px] sm:text-[10px] font-black text-gold uppercase tracking-widest bg-gold/10 px-2 py-0.5 rounded border border-gold/20">
                  {HAND_LABELS[handRankA]}
                </div>
              )}
              {showA && discardIndicesA.length > 0 && (
                <span className="text-[7px] sm:text-[9px] font-black text-white/30 uppercase tracking-[0.1em] italic">
                  {discardIndicesA.length} {discardIndicesA.length === 1 ? 'CARD' : 'CARDS'} SWAPPED
                </span>
              )}
            </div>
            <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 sm:px-4 py-1 rounded-full text-white font-bold text-xs sm:text-sm">
              {playerANickname || playerA?.slice(0, 6) || 'Unknown'}
            </div>
          </div>
        </div>
      </div>
      
      {/* Decorative Lights / Shadows */}
      <div className="absolute inset-0 pointer-events-none rounded-[100px] shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]" />
    </div>
  );
};
