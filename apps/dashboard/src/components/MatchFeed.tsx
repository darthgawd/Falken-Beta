'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Swords, ArrowRight, Loader2, Play, Circle, Zap } from 'lucide-react';
import Link from 'next/link';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { CreateMatchModal } from './CreateMatchModal';

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
const POKER_ALIASES = [
  '0x4173a4e2e54727578fd50a3f1e721827c4c97c3a2824ca469c0ec730d4264b43', // V4
  '0xec63afc7c67678adbe7a60af04d49031878d1e78eff9758b1b79edeb7546dfdf'  // V5
];
const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`;

const ESCROW_ABI = [
  { name: 'joinMatch', type: 'function', stateMutability: 'payable', inputs: [{ name: '_matchId', type: 'uint256' }], outputs: [] },
] as const;

type GameTab = 'ALL' | 'POKER' | 'RPS';

export function MatchFeed({ initialTab = 'ALL', onTabChange }: { initialTab?: GameTab, onTabChange?: (tab: GameTab) => void }) {
  const { authenticated, login } = usePrivy();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<GameTab>(initialTab);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sync internal state with prop
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabClick = (tab: GameTab) => {
    setActiveTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const handleInitiate = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!authenticated) {
      login();
      return;
    }
    setIsModalOpen(true);
  };

  const handleJoin = (e: React.MouseEvent, match: Match) => {
    e.preventDefault();
    e.stopPropagation();

    if (!authenticated) {
      login();
      return;
    }

    const onChainId = BigInt(match.match_id.split('-').pop() || '0');
    
    writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'joinMatch',
      args: [onChainId],
      value: BigInt(match.stake_wei),
    });
  };

  useEffect(() => {
    async function fetchMatches() {
      // 1. Fetch matches
      let query = supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (activeTab === 'RPS') query = query.eq('game_logic', RPS_LOGIC);
      if (activeTab === 'POKER') query = query.in('game_logic', POKER_ALIASES);

      const { data: matchData } = await query.limit(100);
      if (!matchData) {
        setMatches([]);
        setLoading(false);
        return;
      }

      // 2. Identify all unique addresses involved
      const involvedAddresses = new Set<string>();
      matchData.forEach(m => {
        involvedAddresses.add(m.player_a.toLowerCase());
        if (m.player_b) involvedAddresses.add(m.player_b.toLowerCase());
      });

      // 3. Fetch ONLY registered profiles (Managers or Agents)
      const { data: profiles } = await supabase
        .from('agent_profiles')
        .select('address, nickname')
        .in('address', Array.from(involvedAddresses));

      const profileMap = new Map(profiles?.map(p => [p.address.toLowerCase(), p.nickname]) || []);

      // 4. Map nicknames (without filtering out unregistered entities)
      const enrichedMatches = matchData
        .map(m => ({
          ...m,
          player_a_nickname: profileMap.get(m.player_a.toLowerCase()),
          player_b_nickname: m.player_b ? profileMap.get(m.player_b.toLowerCase()) : undefined
        }))
        .sort((a, b) => {
          const idA = parseInt(a.match_id.split('-').pop() || '0');
          const idB = parseInt(b.match_id.split('-').pop() || '0');
          return idB - idA;
        });

      setMatches(enrichedMatches);
      setLoading(false);
    }

    fetchMatches();

    const channel = supabase
      .channel('match-feed-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        fetchMatches();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-zinc-300 dark:text-zinc-800 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 transition-colors duration-500 font-arena">
      <div className="flex gap-4 border-b border-zinc-100 dark:border-zinc-900 pb-4">
        {(['ALL', 'POKER', 'RPS'] as GameTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            className={`text-xs font-black tracking-[0.2em] uppercase transition-all ${
              activeTab === tab ? 'text-blue-600 dark:text-blue-500' : 'text-zinc-300 dark:text-zinc-700 hover:text-zinc-500 dark:hover:text-zinc-500'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      
      <div className="space-y-1">
        {/* Initiate Match Row */}
        <button 
          onClick={handleInitiate}
          className="w-full flex items-center justify-between p-4 bg-emerald-600/[0.05] dark:bg-emerald-500/[0.05] border border-emerald-600/20 dark:border-emerald-500/30 hover:bg-emerald-600/[0.1] dark:hover:bg-emerald-500/[0.1] transition-all group rounded-md mb-4"
        >
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center min-w-[40px]">
              <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-500 animate-pulse" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-xs font-black text-blue-600 dark:text-gold uppercase tracking-[0.2em] mb-0.5">Arena_Action</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-tighter">Initiate_New_Battle</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em]">
            JOIN_BATTLE <Play className="w-4 h-4 fill-emerald-600 dark:fill-emerald-500" />
          </div>
        </button>

        {matches.map((match, index) => (
          <Link 
            key={match.match_id} 
            href={`/match/${match.match_id}`}
            className={`flex items-center justify-between p-4 border border-zinc-100 dark:border-zinc-900/50 hover:border-zinc-200 dark:hover:border-zinc-800 transition-all group rounded-md ${
              index % 2 === 0 
                ? 'bg-blue-600/[0.03] dark:bg-blue-500/[0.03]' 
                : 'bg-blue-600/[0.08] dark:bg-blue-500/[0.08]'
            } hover:bg-blue-600/[0.12] dark:hover:bg-blue-500/[0.12]`}
          >
            <div className="flex items-center gap-6">
              {/* Game Badge */}
              <div className="flex flex-col items-center min-w-[40px]">
                <div className={`text-[10px] font-black tracking-widest ${
                  match.game_logic.toLowerCase() === RPS_LOGIC ? 'text-orange-500' :
                  POKER_ALIASES.includes(match.game_logic.toLowerCase()) ? 'text-blue-500' :
                  'text-zinc-400 dark:text-zinc-700'
                }`}>
                  {match.game_logic.toLowerCase() === RPS_LOGIC ? 'RPS' : 
                   POKER_ALIASES.includes(match.game_logic.toLowerCase()) ? 'POKER' : 'FISE'}
                </div>
                <div className="text-xs font-black text-black dark:text-zinc-200 tabular-nums opacity-80 group-hover:opacity-100 transition-opacity">#{match.match_id.split('-').pop()}</div>
              </div>

              {/* Rivalry */}
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-blue-600 dark:text-gold uppercase tracking-tighter mb-0.5">INITIATOR</span>
                  <span className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                    {match.player_a_nickname || match.player_a.slice(0, 6)}
                  </span>
                </div>
                <Swords className="w-4 h-4 text-zinc-200 dark:text-zinc-800" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-blue-600 dark:text-gold uppercase tracking-tighter mb-0.5">RIVAL</span>
                  <span className={`text-base font-medium ${match.player_b && match.player_b !== '0x0000000000000000000000000000000000000000' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-300 dark:text-zinc-800 italic'}`}>
                    {match.player_b && match.player_b !== '0x0000000000000000000000000000000000000000' ? (match.player_b_nickname || match.player_b.slice(0, 6)) : 'WAITING_FOR_HANDSHAKE...'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-8">
              {/* Stake */}
              <div className="flex flex-col text-right tabular-nums">
                <span className="text-[10px] font-black text-blue-600 dark:text-gold uppercase tracking-tighter mb-0.5">STAKE</span>
                <span className="text-base font-black text-zinc-900 dark:text-zinc-100 italic">{(Number(match.stake_wei) / 1e18).toFixed(6)} <span className="text-xs not-italic text-zinc-500">ETH</span></span>
              </div>
              
              {/* Status / Action */}
              <div className="min-w-[100px] flex justify-end">
                {match.status === 'OPEN' ? (
                  <button 
                    onClick={(e) => handleJoin(e, match)}
                    disabled={isPending || isConfirming}
                    className="flex items-center gap-2 text-xs font-black text-blue-600 dark:text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-colors uppercase tracking-[0.2em]"
                  >
                    {isPending || isConfirming ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>EXEC_JOIN <Play className="w-3 h-3 fill-blue-600 dark:fill-blue-500" /></>
                    )}
                  </button>
                ) : (
                  <div className={`flex items-center gap-2 px-3 py-1 rounded border ${
                    match.status === 'ACTIVE' ? 'bg-blue-600/5 dark:bg-blue-500/5 text-blue-600 dark:text-blue-500 border-blue-600/10 dark:border-blue-500/20' :
                    match.status === 'SETTLED' ? 'bg-emerald-600/5 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-500 border-emerald-600/10 dark:border-emerald-500/20' :
                    'bg-red-600/5 dark:bg-red-500/5 text-red-600 dark:text-red-500 border-red-600/10 dark:border-red-500/20'
                  }`}>
                    {match.status === 'ACTIVE' && <Circle className="w-2 h-2 fill-blue-600 dark:fill-blue-500 animate-pulse" />}
                    <span className="text-[10px] font-black uppercase tracking-widest">{match.status}</span>
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {matches.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 opacity-20 dark:opacity-10 grayscale">
          <Swords className="w-12 h-12 mb-4 text-zinc-400" />
          <span className="text-xs font-black uppercase tracking-[0.5em] text-zinc-500">Arena_Empty</span>
        </div>
      )}

      <CreateMatchModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
