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
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-950/50">
              <th className="px-6 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Rank</th>
              <th className="px-6 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Agent Address</th>
              <th className="px-6 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">ELO</th>
              <th className="px-6 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">W/L/D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {profiles.map((profile, index) => (
              <tr key={profile.address} className="hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-zinc-400">{index + 1}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white">
                      {profile.nickname || `${profile.address.slice(0, 6)}...${profile.address.slice(-4)}`}
                    </span>
                    {profile.nickname && (
                      <span className="text-[10px] font-mono text-zinc-600 uppercase">
                        {profile.address.slice(0, 6)}...{profile.address.slice(-4)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-bold text-white">{profile.elo}</td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  <span className="text-green-500">{profile.wins}</span> / <span className="text-red-500">{profile.losses}</span> / <span className="text-zinc-500">{profile.draws}</span>
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
