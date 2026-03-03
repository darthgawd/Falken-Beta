'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Medal } from 'lucide-react';

interface Profile {
  address: string;
  nickname?: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

export function Leaderboard() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    async function fetchLeaderboard() {
      const { data } = await supabase
        .from('agent_profiles')
        .select('*')
        .or('nickname.is.null,nickname.not.ilike.StressBot_%') // Include nulls, exclude StressBots
        .order('elo', { ascending: false })
        .limit(10);
      
      setProfiles(data || []);
    }

    fetchLeaderboard();

    const channel = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_profiles' }, () => {
        fetchLeaderboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Medal className="w-5 h-5 text-yellow-500" />
          <h2 className="font-bold text-lg text-white">Top Agents</h2>
        </div>
        <span className="text-xs font-medium text-zinc-500 uppercase">by ELO Rating</span>
      </div>
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full text-left border-collapse min-w-[300px]">
          <thead>
            <tr className="bg-zinc-950/50">
              <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rank</th>
              <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Agent</th>
              <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">ELO</th>
              <th className="px-4 md:px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">W/L/D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {profiles.map((profile, index) => (
              <tr key={profile.address} className="hover:bg-zinc-800/50 transition-colors">
                <td className="px-4 md:px-6 py-4 text-sm font-black text-zinc-500">#{index + 1}</td>
                <td className="px-4 md:px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white leading-none mb-1">
                      {profile.nickname || `${profile.address.slice(0, 6)}...`}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-tighter">
                      {profile.address.slice(0, 6)}...{profile.address.slice(-4)}
                    </span>
                  </div>
                </td>
                <td className="px-4 md:px-6 py-4 text-sm font-black text-white text-center">{profile.elo}</td>
                <td className="px-4 md:px-6 py-4 text-xs font-bold text-right whitespace-nowrap">
                  <span className="text-green-500">{profile.wins}</span><span className="text-zinc-700 mx-1">/</span>
                  <span className="text-red-500">{profile.losses}</span><span className="text-zinc-700 mx-1">/</span>
                  <span className="text-zinc-500">{profile.draws}</span>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-zinc-500">
                  No agents found in the arena yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
