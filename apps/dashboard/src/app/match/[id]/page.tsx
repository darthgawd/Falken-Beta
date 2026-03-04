'use client';

import React, { useEffect, useState, useRef, use } from 'react';
import { supabase } from '@/lib/supabase';
import { Navbar } from '@/components/Navbar';
import { ChevronLeft, Swords, Shield, Trophy, Hash, Clock, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface Match {
  match_id: string;
  player_a: string;
  player_b: string;
  stake_wei: string;
  status: string;
  phase: string;
  current_round: number;
  winner: string;
  wins_a: number;
  wins_b: number;
  created_at: string;
  commit_deadline: string;
  reveal_deadline: string;
  settle_tx_hash?: string;
  game_logic: string;
  is_fise?: boolean;
}

interface Round {
  round_number: number;
  player_address: string;
  player_index: number;
  commit_hash: string;
  move: number;
  salt?: string;
  revealed: boolean;
  winner: number;
  commit_tx_hash?: string;
  reveal_tx_hash?: string;
  state_description?: string;
}

const MOVE_LABELS: Record<number, string> = {
  0: '🪨 ROCK',
  1: '📄 PAPER',
  2: '✂️ SCISSORS',
  // Dice results
  101: '🎲 1',
  102: '🎲 2',
  103: '🎲 3',
  104: '🎲 4',
  105: '🎲 5',
  106: '🎲 6'
};

const CardDisplay = ({ cardId, isDiscarded = false }: { cardId: number, isDiscarded?: boolean }) => {
  const suits = ['♣', '♦', '♥', '♠']; // 0=Clubs, 1=Diamonds, 2=Hearts, 3=Spades
  const suitColors = { '♣': 'text-zinc-400', '♦': 'text-blue-500', '♥': 'text-red-500', '♠': 'text-zinc-100' };
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  const suit = suits[Math.floor(cardId / 13)];
  const rank = ranks[cardId % 13];
  const color = suitColors[suit as keyof typeof suitColors];

  return (
    <div className={`w-16 h-24 rounded-xl border bg-zinc-950 flex flex-col items-center justify-center relative ${isDiscarded ? 'opacity-30 border-dashed border-zinc-800' : 'border-zinc-700 shadow-xl shadow-black/80'}`}>
      <span className={`text-xl font-black leading-none mb-1 ${isDiscarded ? 'text-zinc-800' : 'text-white'}`}>{rank}</span>
      <span className={`text-2xl ${isDiscarded ? 'text-zinc-800' : color}`}>{suit}</span>
      {isDiscarded && <div className="absolute inset-0 flex items-center justify-center"><div className="w-full h-[2px] bg-red-500/40 rotate-45" /></div>}
    </div>
  );
};

const PokerHand = ({ player, matchId, move, round, playerA, saltA, saltB, logicId }: { player: string, matchId: string, move: number | string, round: number, playerA: string, saltA?: string, saltB?: string, logicId: string }) => {
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

  // 2. Determine Seed based on Logic Version
  const cleanLogicId = logicId.toLowerCase();
  const pokerLogicIdV6 = '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846';
  
  // FIX: Use numerical matchId to match poker.js and bot logic seed
  const numericalId = matchId.split('-').pop() || matchId;
  let seed = numericalId + "_" + round;
  if (cleanLogicId === pokerLogicIdV6) {
    // BLIND DECK protocol (V6)
    seed = numericalId + "_" + round + "_" + (saltA || "") + "_" + (saltB || "");
  }

  const deck = generateDeck(seed);
  const isA = player.toLowerCase() === playerA.toLowerCase();
  const initialHandOffset = isA ? 0 : 5;
  const initialHand = deck.slice(initialHandOffset, initialHandOffset + 5);
  
  const discardIndices = move.toString() === '99' ? [] : move.toString().split('').map(Number);
  
  let finalHand = [...initialHand];
  const replacementOffset = isA ? 10 : 15;
  discardIndices.forEach((idx, i) => { 
    if (idx >= 0 && idx < 5) finalHand[idx] = deck[replacementOffset + i]; 
  });

  return (
    <div className="flex gap-3 bg-black/40 p-4 rounded-2xl border border-zinc-800/50 scale-110 origin-left mt-2">
      {finalHand.map((cid, i) => (
        <CardDisplay key={i} cardId={cid} />
      ))}
    </div>
  );
};

const RPS_LOGIC = (process.env.NEXT_PUBLIC_RPS_LOGIC_ADDRESS || '').toLowerCase();
const DICE_LOGIC = (process.env.NEXT_PUBLIC_DICE_LOGIC_ADDRESS || '').toLowerCase();
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '').toLowerCase();

export default function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.id;
  const [match, setMatch] = useState<Match | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const fetchSeq = useRef(0);

  useEffect(() => {
    async function fetchData() {
      // Stale-response guard: each call gets a sequence number.
      // If a newer call was started before this one finishes, discard our results.
      const seq = ++fetchSeq.current;

      const { data: matchData } = await supabase
        .from('matches')
        .select('*')
        .eq('match_id', matchId)
        .single();

      const { data: roundsData } = await supabase
        .from('rounds')
        .select('*')
        .eq('match_id', matchId)
        .order('round_number', { ascending: true });

      // Discard if a newer fetch was kicked off while we were awaiting
      if (seq !== fetchSeq.current) return;

      if (matchData) {
        let playerB = matchData.player_b;

        // SELF-HEALING: If player_b is null but we have rounds, find player B's address
        if (!playerB && roundsData && roundsData.length > 0) {
            const playerBEntry = roundsData.find(r => r.player_address.toLowerCase() !== matchData.player_a.toLowerCase());
            if (playerBEntry) {
                playerB = playerBEntry.player_address;
                matchData.player_b = playerB; // Update the object in memory
            }
        }

        setMatch(matchData);

        // Fetch nicknames for both players
        const addresses = [matchData.player_a.toLowerCase()];
        if (playerB) addresses.push(playerB.toLowerCase());

        const { data: profiles } = await supabase
          .from('agent_profiles')
          .select('address, nickname')
          .in('address', addresses);

        // Final stale check after nickname fetch
        if (seq !== fetchSeq.current) return;

        const nameMap: Record<string, string> = {};
        profiles?.forEach(p => {
          if (p.nickname) nameMap[p.address.toLowerCase()] = p.nickname;
        });
        setNicknames(nameMap);
      }
      setRounds(roundsData || []);
      setLoading(false);
    }

    fetchData();

    const matchChannel = supabase
      .channel(`match-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `match_id=eq.${matchId}` }, () => {
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `match_id=eq.${matchId}` }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchChannel);
    };
  }, [matchId]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  if (loading) return null;
  if (!match) return <div className="p-20 text-center text-white">Match not found</div>;

  const groupedRounds = (rounds || []).reduce((acc, r) => {
    if (!r || typeof r.round_number !== 'number') return acc;
    if (!acc[r.round_number]) acc[r.round_number] = { round: r.round_number, a: null, b: null, winner: r.winner };
    if (r.player_index === 1) acc[r.round_number].a = r;
    else if (r.player_index === 2) acc[r.round_number].b = r;
    return acc;
  }, {} as Record<number, { round: number, a: Round | null, b: Round | null, winner: number }>);

  const sortedRounds = Object.values(groupedRounds).sort((a, b) => b.round - a.round);

  const getFiseMoveLabel = (move: number, logicId: string) => {
    const pokerLogicIdV4 = '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43';
    const pokerLogicIdV5 = '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf';
    const pokerLogicIdV6 = '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846';
    const rpsLogicId = '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3';
    const rpsLogicIdV2 = '0x31adebc3e6f489dab0e3d7867ef5cf63b27bd0735ce35f1cc7f671e3c303ef3a';

    const cleanLogicId = logicId.toLowerCase();

    // 1. POKER BLITZ
    if (cleanLogicId === pokerLogicIdV4 || cleanLogicId === pokerLogicIdV5 || cleanLogicId === pokerLogicIdV6) {
      if (Number(move) === 99) return '🃏 KEEP ALL';
      const count = move.toString().length;
      return `🃏 ${count} ${count === 1 ? 'CARD' : 'CARDS'} DISCARDED`;
    }

    // 2. ROCK PAPER SCISSORS
    if (cleanLogicId === rpsLogicId || cleanLogicId === rpsLogicIdV2) {
      return MOVE_LABELS[move] || `MOVE: ${move}`;
    }

    return MOVE_LABELS[move] || `MOVE: ${move}`;
  };

  return (
    <main className="min-h-screen bg-black text-zinc-400 font-sans pb-20">
      <Navbar />
      
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors group">
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Arena
        </Link>

        {/* Status Header */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className={`px-3 py-1 rounded-lg font-bold text-[10px] border ${
                match.game_logic?.toLowerCase() === RPS_LOGIC ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                match.game_logic?.toLowerCase() === DICE_LOGIC ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
                match.is_fise || (match.game_logic?.toLowerCase() === ESCROW_ADDRESS && ESCROW_ADDRESS) ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' :
                'bg-zinc-800 text-zinc-500 border-zinc-700'
              }`}>
                {match.game_logic?.toLowerCase() === RPS_LOGIC ? 'RPS' :
                 match.game_logic?.toLowerCase() === DICE_LOGIC ? 'DICE' :
                 match.is_fise || (match.game_logic?.toLowerCase() === ESCROW_ADDRESS && ESCROW_ADDRESS) ? 'FISE' : '??'}
              </div>
              <div className="flex items-center gap-2">
                <Swords className="w-5 h-5 text-red-500" />
                <h1 className="text-xl font-bold text-white uppercase tracking-tighter">Match #{match.match_id.split('-').pop()}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                match.status === 'ACTIVE' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                match.status === 'SETTLED' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                'bg-zinc-800 text-zinc-500 border-zinc-700'
              }`}>
                {match.status}
              </span>
              {match.settle_tx_hash && (
                <a 
                  href={`https://sepolia.basescan.org/tx/${match.settle_tx_hash}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] font-bold text-green-500/50 hover:text-green-500 transition-colors uppercase"
                >
                  <ExternalLink className="w-3 h-3" />
                  Settlement TX
                </a>
              )}
            </div>
            <p className="text-xs font-mono text-zinc-600">ID: {match.match_id}</p>
          </div>

          <div className="flex gap-12">
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Prize Pool</p>
              <p className="text-xl font-bold text-white tracking-tight">{(Number(match.stake_wei) * 2 / 1e18).toFixed(5)} ETH</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Phase</p>
              <p className={`text-xl font-bold tracking-tight ${
                match.status === 'SETTLED' ? 'text-green-500' :
                match.status === 'VOIDED' ? 'text-red-500' :
                'text-blue-500'
              }`}>
                {match.status === 'SETTLED' ? 'COMPLETE' : 
                 match.status === 'VOIDED' ? 'VOIDED' : 
                 match.phase}
              </p>
            </div>
          </div>
        </div>

        {/* Versus Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-8 flex flex-col items-center gap-4 ${match.winner === match.player_a ? 'bg-emerald-500/5' : ''}`}>
            <div className="w-16 h-16 rounded-none bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-black italic text-xl">A</div>
            <div className="text-center">
              <p className="text-xl font-black text-white uppercase tracking-widest truncate max-w-[240px]">
                {nicknames[match.player_a.toLowerCase()] || match.player_a.slice(0, 8)}
              </p>
              <p className="text-6xl font-black text-white mt-4 tabular-nums italic tracking-tighter">{match.wins_a}</p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-8 grayscale opacity-20">
            <Swords className="w-16 h-16 text-zinc-500 mb-2" />
            <span className="text-[10px] font-black text-zinc-600 tracking-[0.5em] uppercase">Versus</span>
          </div>

          <div className={`p-8 flex flex-col items-center gap-4 ${match.winner === match.player_b ? 'bg-emerald-500/5' : ''}`}>
            <div className="w-16 h-16 rounded-none bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black italic text-xl">B</div>
            <div className="text-center">
              <p className="text-xl font-black text-white uppercase tracking-widest truncate max-w-[240px]">
                {match.player_b && match.player_b !== '0x0000000000000000000000000000000000000000'
                  ? (nicknames[match.player_b.toLowerCase()] || match.player_b.slice(0, 8)) : 'WAITING...'}
              </p>
              <p className="text-6xl font-black text-white mt-4 tabular-nums italic tracking-tighter">{match.wins_b}</p>
            </div>
          </div>
        </div>

        {/* Round History */}
        <div className="space-y-4 pt-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" />
            Battle Log
          </h2>
          
          <div className="space-y-3">
            {sortedRounds.map((round) => (
              <div key={round.round} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="bg-zinc-900 px-6 py-3 border-b border-zinc-800 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-white uppercase tracking-widest">ROUND {round.round}</span>
                    {round.a?.state_description && (
                      <span className="text-[10px] font-medium text-zinc-500 mt-0.5">{round.a.state_description}</span>
                    )}
                  </div>
                  <span className={`text-xs font-black uppercase tracking-widest ${
                    round.winner === 0 ? 'text-zinc-500' : 'text-emerald-500'
                  }`}>
                    {round.winner === 0 ? 'DRAW' : round.winner === 1 ? 'PLAYER A WON' : round.winner === 2 ? 'PLAYER B WON' : 'IN PROGRESS'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800 min-h-[320px]">
                  {/* Player A's action */}
                  <div className="p-10 flex flex-col justify-center gap-4">
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Player A</span>
                    {round.a?.revealed && round.a?.move != null ? (
                      <div className="flex flex-col gap-4">
                        <span className="text-3xl font-black text-blue-400 italic tracking-tight">
                          {getFiseMoveLabel(round.a.move, match.game_logic)}
                        </span>
                        {(match.game_logic.toLowerCase() === '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43' || match.game_logic.toLowerCase() === '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf' || match.game_logic.toLowerCase() === '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846') && round.a.salt && (
                          <PokerHand player={match.player_a} matchId={match.match_id} move={round.a.move} round={round.round} playerA={match.player_a} saltA={round.a?.salt} saltB={round.b?.salt} logicId={match.game_logic} />
                        )}
                      </div>
                    ) : round.a?.revealed ? (
                      <span className="text-sm font-bold text-yellow-500 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded animate-pulse w-fit">REVEALED</span>
                    ) : round.a?.commit_hash ? (
                      <span className="text-sm font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded w-fit">COMMITTED</span>
                    ) : (
                      <span className="text-sm font-bold text-zinc-700 italic uppercase tracking-widest">
                        {round.winner !== null ? 'NO ACTION' : 'WAITING...'}
                      </span>
                    )}
                  </div>

                  {/* Player B's action */}
                  <div className="p-10 flex flex-col justify-center gap-4">
                    <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Player B</span>
                    {round.b?.revealed && round.b?.move != null ? (
                      <div className="flex flex-col gap-4">
                        <span className="text-3xl font-black text-purple-400 italic tracking-tight">
                          {getFiseMoveLabel(round.b.move, match.game_logic)}
                        </span>
                        {(match.game_logic.toLowerCase() === '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43' || match.game_logic.toLowerCase() === '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf' || match.game_logic.toLowerCase() === '0x5f164061c4cbb981098161539f7f691650e0c245be54ade84ea5b57496955846') && round.b.salt && (
                          <PokerHand player={match.player_b} matchId={match.match_id} move={round.b.move} round={round.round} playerA={match.player_a} saltA={round.a?.salt} saltB={round.b?.salt} logicId={match.game_logic} />
                        )}
                      </div>
                    ) : round.b?.revealed ? (
                      <span className="text-sm font-bold text-yellow-500 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded animate-pulse w-fit">REVEALED</span>
                    ) : round.b?.commit_hash ? (
                      <span className="text-sm font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded w-fit">COMMITTED</span>
                    ) : (
                      <span className="text-sm font-bold text-zinc-700 italic uppercase tracking-widest">
                        {round.winner !== null ? 'NO ACTION' : 'WAITING...'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
