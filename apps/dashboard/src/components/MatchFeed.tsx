'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Swords, ArrowRight, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface Match {
  match_id: string;
  player_a: string;
  player_b: string;
  stake_wei: string;
  status: string;
  phase: string;
  game_logic: string;
  current_round: number;
  winner: string;
  created_at: string;
  player_a_nickname?: string;
  player_b_nickname?: string;
}

const RPS_LOGIC = (process.env.NEXT_PUBLIC_RPS_LOGIC_ADDRESS || '').toLowerCase();
const DICE_LOGIC = (process.env.NEXT_PUBLIC_DICE_LOGIC_ADDRESS || '').toLowerCase();

type GameTab = 'ALL' | 'RPS' | 'DICE';

export function MatchFeed() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<GameTab>('ALL');

  useEffect(() => {
    async function fetchMatches() {
      let query = supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (activeTab === 'RPS') query = query.eq('game_logic', RPS_LOGIC);
      if (activeTab === 'DICE') query = query.eq('game_logic', DICE_LOGIC);

      const { data: matchData } = await query.limit(20);
      if (!matchData) {
        setMatches([]);
        setLoading(false);
        return;
      }

      // Fetch nicknames for all players
      const addresses = new Set<string>();
      matchData.forEach(m => {
        addresses.add(m.player_a.toLowerCase());
        if (m.player_b) addresses.add(m.player_b.toLowerCase());
      });

      const { data: profiles } = await supabase
        .from('agent_profiles')
        .select('address, nickname')
        .in('address', Array.from(addresses));

      const profileMap = new Map(profiles?.map(p => [p.address.toLowerCase(), p.nickname]) || []);

      const enrichedMatches = matchData.map(m => ({
        ...m,
        player_a_nickname: profileMap.get(m.player_a.toLowerCase()),
        player_b_nickname: m.player_b ? profileMap.get(m.player_b.toLowerCase()) : undefined
      })).filter(m => {
        // Only filter out IF nickname exists and is a StressBot
        const isAStress = m.player_a_nickname?.startsWith('StressBot_');
        const isBStress = m.player_b_nickname?.startsWith('StressBot_');
        return !isAStress && !isBStress;
      });

      setMatches(enrichedMatches);
      setLoading(false);
    }

    fetchMatches();

    const channel = supabase
      .channel('match-feed-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        console.log('Realtime Match Update:', payload);
        fetchMatches();
      })
      .subscribe((status) => {
        console.log('MatchFeed Subscription Status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-red-500" />
          <h2 className="font-bold text-lg text-white">Match Arena</h2>
        </div>
        
        {/* Game Tabs */}
        <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800 self-start">
          {(['ALL', 'RPS', 'DICE'] as GameTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === tab 
                  ? 'bg-zinc-800 text-white shadow-lg' 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      
      <div className="grid gap-4">
        {matches.map((match) => (
          <Link 
            key={match.match_id} 
            href={`/match/${match.match_id}`}
            className="bg-zinc-900 border border-zinc-800 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-zinc-800/50 transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-[10px] border ${
                    match.game_logic.toLowerCase() === RPS_LOGIC ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                    match.game_logic.toLowerCase() === DICE_LOGIC ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
                    'bg-zinc-800 text-zinc-500 border-zinc-700'
                }`}>
                    {match.game_logic.toLowerCase() === RPS_LOGIC ? 'RPS' :
                    match.game_logic.toLowerCase() === DICE_LOGIC ? 'DICE' : '??'}
                </div>
                <span className="text-[9px] font-bold text-zinc-600 mt-1">#{match.match_id.split('-').pop()}</span>
              </div>
              <div className="flex flex-col min-w-[80px]">
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">PLAYER A</span>
                <span className="text-sm font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                  {match.player_a_nickname || `${match.player_a.slice(0, 6)}...${match.player_a.slice(-4)}`}
                </span>
                {match.player_a_nickname && (
                  <span className="text-[10px] font-mono text-zinc-600 uppercase">{match.player_a.slice(0, 6)}...</span>
                )}
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-700" />
              <div className="flex flex-col min-w-[80px]">
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">PLAYER B</span>
                <span className="text-sm font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                  {match.player_b ? (match.player_b_nickname || `${match.player_b.slice(0, 6)}...${match.player_b.slice(-4)}`) : 'WAITING...'}
                </span>
                {match.player_b && match.player_b_nickname && (
                  <span className="text-[10px] font-mono text-zinc-600 uppercase">{match.player_b.slice(0, 6)}...</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex flex-col text-right">
                <span className="text-xs font-medium text-zinc-500 uppercase mb-1">Stake</span>
                <span className="text-sm font-bold text-white">{(Number(match.stake_wei) / 1e18).toFixed(4)} ETH</span>
              </div>
              <div className="flex flex-col text-right min-w-[100px]">
                <span className="text-xs font-medium text-zinc-500 uppercase mb-1">Status</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-md uppercase tracking-wider text-center ${
                  match.status === 'ACTIVE' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                  match.status === 'SETTLED' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                  match.status === 'VOIDED' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                  'bg-zinc-800 text-zinc-400'
                }`}>
                  {match.status}
                </span>
              </div>
              <div className="hidden lg:flex flex-col text-right items-end">
                <ExternalLink className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              </div>
            </div>
          </Link>
        ))}
        {matches.length === 0 && (
          <div className="bg-zinc-900 border border-zinc-800 p-12 rounded-2xl text-center">
            <p className="text-zinc-500 text-sm font-medium italic">The arena is quiet... for now.</p>
          </div>
        )}
      </div>
    </div>
  );
}
