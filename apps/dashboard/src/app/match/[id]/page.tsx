'use client';

import React, { useEffect, useState, use } from 'react';
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
}

interface Round {
  round_number: number;
  player_address: string;
  player_index: number;
  commit_hash: string;
  move: number;
  revealed: boolean;
  winner: number;
  commit_tx_hash?: string;
  reveal_tx_hash?: string;
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

const RPS_LOGIC = (process.env.NEXT_PUBLIC_RPS_LOGIC_ADDRESS || '').toLowerCase();
const DICE_LOGIC = (process.env.NEXT_PUBLIC_DICE_LOGIC_ADDRESS || '').toLowerCase();

export default function MatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.id;
  const [match, setMatch] = useState<Match | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
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

  const groupedRounds = rounds.reduce((acc, r) => {
    if (!acc[r.round_number]) acc[r.round_number] = { round: r.round_number, a: null, b: null, winner: r.winner };
    if (r.player_index === 1) acc[r.round_number].a = r;
    else acc[r.round_number].b = r;
    return acc;
  }, {} as Record<number, { round: number, a: Round | null, b: Round | null, winner: number }>);

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
                'bg-zinc-800 text-zinc-500 border-zinc-700'
              }`}>
                {match.game_logic?.toLowerCase() === RPS_LOGIC ? 'RPS' :
                 match.game_logic?.toLowerCase() === DICE_LOGIC ? 'DICE' : '??'}
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
          <div className={`p-6 rounded-2xl border transition-all ${match.winner === match.player_a ? 'bg-green-500/5 border-green-500/20' : 'bg-zinc-900 border-zinc-800'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold text-xs">A</div>
              <span className="text-xs font-bold text-white truncate flex-1">
                {nicknames[match.player_a.toLowerCase()] || `${match.player_a.slice(0, 6)}...${match.player_a.slice(-4)}`}
              </span>
              {match.winner === match.player_a && <Trophy className="w-4 h-4 text-yellow-500" />}
            </div>
            <p className="text-4xl font-black text-white">{match.wins_a}</p>
            <p className="text-[10px] font-bold text-zinc-600 uppercase mt-1">Rounds Won</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-zinc-800/20 opacity-50 flex items-center justify-center">
              <Swords className="w-24 h-24 text-zinc-900" />
            </div>
            <span className="text-xl font-black text-zinc-700 italic relative z-10">VS</span>
          </div>

          <div className={`p-6 rounded-2xl border transition-all ${match.winner === match.player_b ? 'bg-green-500/5 border-green-500/20' : 'bg-zinc-900 border-zinc-800'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-500 font-bold text-xs">B</div>
              <span className="text-xs font-bold text-white truncate flex-1">
                {match.player_b 
                  ? (nicknames[match.player_b.toLowerCase()] || `${match.player_b.slice(0, 6)}...${match.player_b.slice(-4)}`) 
                  : 'Waiting...'}
              </span>
              {match.winner === match.player_b && <Trophy className="w-4 h-4 text-yellow-500" />}
            </div>
            <p className="text-4xl font-black text-white">{match.wins_b}</p>
            <p className="text-[10px] font-bold text-zinc-600 uppercase mt-1">Rounds Won</p>
          </div>
        </div>

        {/* Round History */}
        <div className="space-y-4 pt-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-500" />
            Battle Log
          </h2>
          
          <div className="space-y-3">
            {Object.values(groupedRounds).reverse().map((round) => (
              <div key={round.round} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="bg-zinc-900 px-6 py-3 border-b border-zinc-800 flex justify-between items-center">
                  <span className="text-xs font-black text-white">ROUND {round.round}</span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">
                    {round.winner === 0 ? 'DRAW' : round.winner === 1 ? 'PLAYER A WON' : round.winner === 2 ? 'PLAYER B WON' : 'IN PROGRESS'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
                  {/* Player A's action */}
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-zinc-600 uppercase">Player A</span>
                      {round.a?.revealed ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-blue-400">{MOVE_LABELS[round.a.move]}</span>
                          {round.a.reveal_tx_hash && (
                            <a href={`https://sepolia.basescan.org/tx/${round.a.reveal_tx_hash}`} target="_blank" rel="noopener noreferrer" title="Reveal Transaction">
                              <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400" />
                            </a>
                          )}
                        </div>
                      ) : round.a?.commit_hash ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded">COMMITTED</span>
                          {round.a.commit_tx_hash && (
                            <a href={`https://sepolia.basescan.org/tx/${round.a.commit_tx_hash}`} target="_blank" rel="noopener noreferrer" title="Commit Transaction">
                              <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-zinc-700">
                          {round.winner !== null ? 'NO ACTION' : 'WAITING...'}
                        </span>
                      )}
                    </div>
                    {round.a?.commit_hash && (
                      <div className="bg-black/40 p-3 rounded-lg flex items-center justify-between group cursor-pointer" onClick={() => copyToClipboard(round.a?.commit_hash || '')}>
                        <div className="flex items-center gap-2 truncate">
                          <Hash className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                          <span className="text-[10px] font-mono text-zinc-600 truncate">{round.a.commit_hash}</span>
                        </div>
                        {copiedHash === round.a.commit_hash ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-zinc-800 group-hover:text-zinc-500" />}
                      </div>
                    )}
                  </div>

                  {/* Player B's action */}
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-zinc-600 uppercase">Player B</span>
                      {round.b?.revealed ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-purple-400">{MOVE_LABELS[round.b.move]}</span>
                          {round.b.reveal_tx_hash && (
                            <a href={`https://sepolia.basescan.org/tx/${round.b.reveal_tx_hash}`} target="_blank" rel="noopener noreferrer" title="Reveal Transaction">
                              <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400" />
                            </a>
                          )}
                        </div>
                      ) : round.b?.commit_hash ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-zinc-500 px-2 py-1 bg-zinc-800 rounded">COMMITTED</span>
                          {round.b.commit_tx_hash && (
                            <a href={`https://sepolia.basescan.org/tx/${round.b.commit_tx_hash}`} target="_blank" rel="noopener noreferrer" title="Commit Transaction">
                              <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-zinc-700">
                          {round.winner !== null ? 'NO ACTION' : 'WAITING...'}
                        </span>
                      )}
                    </div>
                    {round.b?.commit_hash && (
                      <div className="bg-black/40 p-3 rounded-lg flex items-center justify-between group cursor-pointer" onClick={() => copyToClipboard(round.b?.commit_hash || '')}>
                        <div className="flex items-center gap-2 truncate">
                          <Hash className="w-3 h-3 text-zinc-700 flex-shrink-0" />
                          <span className="text-[10px] font-mono text-zinc-600 truncate">{round.b.commit_hash}</span>
                        </div>
                        {copiedHash === round.b.commit_hash ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-zinc-800 group-hover:text-zinc-500" />}
                      </div>
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
