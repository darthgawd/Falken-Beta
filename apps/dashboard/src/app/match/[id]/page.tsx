'use client';

import React, { useEffect, useState, useRef, use } from 'react';
import { supabase } from '@/lib/supabase';
import { Navbar } from '@/components/Navbar';
import { ChevronLeft, Swords, Shield, Trophy, Hash, Clock, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { PokerTable } from '@/components/PokerTable';

interface Match {
  match_id: string;
  players: string[];
  stake_wei: string;
  status: string;
  phase: string;
  current_round: number;
  winner: string;
  wins: number[];
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

const HAND_LABELS = [
  "High Card", "Pair", "Two Pair", "Three of a Kind", 
  "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"
];

const RPS_LOGIC = (process.env.NEXT_PUBLIC_RPS_LOGIC_ADDRESS || '').toLowerCase();
const DICE_LOGIC = (process.env.NEXT_PUBLIC_DICE_LOGIC_ADDRESS || '').toLowerCase();
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '').toLowerCase();

const POKER_LOGIC_IDS = [
  '0x941e596b0c66e32eb8186fe5c43b990e128b0469bb9fe233512c2ad8a7b254c5' // Official PokerShowDownFinal (Sync)
].map(id => id.toLowerCase());

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

      if (seq !== fetchSeq.current) return;

      if (matchData) {
        setMatch(matchData);

        const addresses = (matchData.players || []).map((p: string) => p.toLowerCase());

        const { data: profiles } = await supabase
          .from('agent_profiles')
          .select('address, nickname')
          .in('address', addresses);

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

  if (loading) return null;
  if (!match) return <div className="p-20 text-center text-white">Match not found</div>;

  const groupedRounds = (rounds || []).reduce((acc, r) => {
    if (!r || typeof r.round_number !== 'number') return acc;
    if (!acc[r.round_number]) acc[r.round_number] = { round: r.round_number, a: null, b: null, winner: r.winner };
    if (r.player_index === 0) acc[r.round_number].a = r;
    else if (r.player_index === 1) acc[r.round_number].b = r;
    return acc;
  }, {} as Record<number, { round: number, a: Round | null, b: Round | null, winner: number }>);

  const sortedRounds = Object.values(groupedRounds).sort((a, b) => b.round - a.round);

  const getFiseMoveLabel = (move: number, logicId: string) => {
    const pokerLogicIdOfficial = '0x941e596b0c66e32eb8186fe5c43b990e128b0469bb9fe233512c2ad8a7b254c5';
    const rpsLogicId = '0xf2f80f1811f9e2c534946f0e8ddbdbd5c1e23b6e48772afe3bccdb9f2e1cfdf3';

    const cleanLogicId = (logicId || '').toLowerCase();

    if (cleanLogicId === pokerLogicIdOfficial) {
      const moveVal = Number(move);
      if (moveVal === 99 || moveVal === 0) return '🃏 STAY';
      
      // Count bits set in bitmask (0-4)
      let count = 0;
      for (let i = 0; i < 5; i++) {
        if (moveVal & (1 << i)) count++;
      }
      return `🃏 ${count} ${count === 1 ? 'CARD' : 'CARDS'} DISCARDED`;
    }

    return MOVE_LABELS[move] || `MOVE: ${move}`;
  };

  // Calculate real-time scores from rounds
  const scoreA = Object.values(groupedRounds).filter(r => r.winner === 1).length;
  const scoreB = Object.values(groupedRounds).filter(r => r.winner === 2).length;

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
                'bg-cyan-500/10 text-cyan-500 border-cyan-500/20'
              }`}>
                {match.game_logic?.toLowerCase() === RPS_LOGIC ? 'RPS' :
                 match.game_logic?.toLowerCase() === DICE_LOGIC ? 'DICE' : 'FISE'}
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
                <a href={`https://sepolia.basescan.org/tx/${match.settle_tx_hash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-green-500/50 hover:text-green-500 transition-colors uppercase">
                  <ExternalLink className="w-3 h-3" /> Settlement TX
                </a>
              )}
            </div>
            <p className="text-xs font-mono text-zinc-600">ID: {match.match_id}</p>
          </div>

          <div className="flex gap-12">
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Phase</p>
              <p className={`text-xl font-bold tracking-tight ${match.status === 'SETTLED' ? 'text-green-500' : 'text-blue-500'}`}>
                {match.status === 'SETTLED' ? 'COMPLETE' : match.phase}
              </p>
            </div>
          </div>
        </div>

        {/* Versus Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-8 flex flex-col items-center gap-4 ${match.winner === match.players[0] ? 'bg-emerald-500/5' : ''}`}>
            <div className="w-16 h-16 rounded-none bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-black italic text-xl">A</div>
            <div className="text-center">
              <p className="text-xl font-black text-white uppercase tracking-widest truncate max-w-[240px]">
                {nicknames[match.players[0]?.toLowerCase()] || match.players[0]?.slice(0, 8)}
              </p>
              <p className="text-6xl font-black text-white mt-4 tabular-nums italic tracking-tighter">{scoreA}</p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-8 grayscale opacity-20">
            <Swords className="w-16 h-16 text-zinc-500 mb-2" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black text-zinc-600 tracking-[0.5em] uppercase text-center">Versus</span>
              <span className="text-[14px] font-black text-white italic tracking-widest">
                {(Number(match.stake_wei || 0) / 1e6).toFixed(2)} USDC
              </span>
            </div>
          </div>

          <div className={`p-8 flex flex-col items-center gap-4 ${match.winner === match.players[1] ? 'bg-emerald-500/5' : ''}`}>
            <div className="w-16 h-16 rounded-none bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 font-black italic text-xl">B</div>
            <div className="text-center">
              <p className="text-xl font-black text-white uppercase tracking-widest truncate max-w-[240px]">
                {match.players[1] && match.players[1] !== '0x0000000000000000000000000000000000000000'
                  ? (nicknames[match.players[1].toLowerCase()] || match.players[1].slice(0, 8)) : 'WAITING...'}
              </p>
              <p className="text-6xl font-black text-white mt-4 tabular-nums italic tracking-tighter">{scoreB}</p>
            </div>
          </div>
        </div>

        {/* Pre-Game Table - Shows before any rounds start */}
        {POKER_LOGIC_IDS.includes(match.game_logic?.toLowerCase()) && (match.status === 'OPEN' || match.status === 'ACTIVE' || match.status === 'SETTLED') && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden mb-4">
            <div className="bg-zinc-900 px-6 py-3 border-b border-zinc-800 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-xs font-black text-white uppercase tracking-widest">TABLE READY</span>
              </div>
              <span className="text-xs font-black uppercase tracking-widest text-yellow-500">
                {match.status === 'OPEN' ? 'WAITING FOR OPPONENT' : 'READY TO PLAY'}
              </span>
            </div>
            <div className="p-4 sm:p-10">
              <PokerTable 
                matchId={match.match_id}
                playerA={match.players[0] || 'WAITING'}
                playerB={match.players[1] || 'WAITING'}
                round={1}
                logicId={match.game_logic}
                playerANickname={match.players[0] ? nicknames[match.players[0].toLowerCase()] : 'WAITING...'}
                playerBNickname={match.players[1] ? nicknames[match.players[1].toLowerCase()] : 'WAITING...'}
                isShowdown={false}
              />
            </div>
          </div>
        )}

        {/* Round History */}
        <div className="space-y-4 pt-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" /> Battle Log
          </h2>
          <div className="space-y-3">
            {sortedRounds.map((round) => (
              <div key={round.round} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="bg-zinc-900 px-6 py-3 border-b border-zinc-800 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-white uppercase tracking-widest">ROUND {round.round}</span>
                  </div>
                  <span className={`text-xs font-black uppercase tracking-widest ${round.winner === 0 ? 'text-zinc-500' : 'text-emerald-500'}`}>
                    {round.winner === 0 ? 'DRAW' : round.winner === 1 ? 'PLAYER A WON' : round.winner === 2 ? 'PLAYER B WON' : 'IN PROGRESS'}
                  </span>
                </div>
                <div className={`grid grid-cols-1 ${POKER_LOGIC_IDS.includes(match.game_logic?.toLowerCase()) ? '' : 'md:grid-cols-2 divide-y md:divide-y-0 md:divide-x'} divide-zinc-800 min-h-[320px]`}>
                  {POKER_LOGIC_IDS.includes(match.game_logic?.toLowerCase()) ? (
                    <div className="p-4 sm:p-10">
                      <PokerTable 
                        matchId={match.match_id}
                        playerA={match.players[0] || 'WAITING'}
                        playerB={match.players[1] || 'WAITING'}
                        round={round.round}
                        logicId={match.game_logic}
                        playerAMove={round.a?.move}
                        playerBMove={round.b?.move}
                        playerASalt={round.a?.salt}
                        playerBSalt={round.b?.salt}
                        playerANickname={match.players[0] ? nicknames[match.players[0].toLowerCase()] : 'Player A'}
                        playerBNickname={match.players[1] ? nicknames[match.players[1].toLowerCase()] : undefined}
                        isShowdown={round.a?.revealed && round.b?.revealed}
                        winner={round.winner}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="p-10 flex flex-col justify-center gap-4">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Player A</span>
                        {round.a?.revealed && round.a?.move != null ? (
                          <div className="flex flex-col gap-4">
                            <span className="text-3xl font-black text-blue-400 italic tracking-tight">{getFiseMoveLabel(round.a.move, match.game_logic)}</span>
                          </div>
                        ) : round.a?.revealed ? (
                          <span className="text-sm font-bold text-yellow-500 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded animate-pulse w-fit">REVEALED</span>
                        ) : round.a?.commit_hash ? (
                          <span className="text-sm font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded w-fit">COMMITTED</span>
                        ) : (
                          <span className="text-sm font-bold text-zinc-700 italic uppercase tracking-widest">{round.winner !== null ? 'NO ACTION' : 'WAITING...'}</span>
                        )}
                      </div>
                      <div className="p-10 flex flex-col justify-center gap-4">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Player B</span>
                        {round.b?.revealed && round.b?.move != null ? (
                          <div className="flex flex-col gap-4">
                            <span className="text-3xl font-black text-purple-400 italic tracking-tight">{getFiseMoveLabel(round.b.move, match.game_logic)}</span>
                          </div>
                        ) : round.b?.revealed ? (
                          <span className="text-sm font-bold text-yellow-500 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded animate-pulse w-fit">REVEALED</span>
                        ) : round.b?.commit_hash ? (
                          <span className="text-sm font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded w-fit">COMMITTED</span>
                        ) : (
                          <span className="text-sm font-bold text-zinc-700 italic uppercase tracking-widest">{round.winner !== null ? 'NO ACTION' : 'WAITING...'}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
