'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Zap, Target, Coins, Trophy } from 'lucide-react';

export function StatsGrid() {
  const [stats, setStats] = useState({
    activeMatches: 0,
    totalVolume: '0',
    totalPlayers: 0,
    settledMatches: 0
  });

  useEffect(() => {
    async function fetchStats() {
      const { count: activeCount } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ACTIVE');

      const { count: settledCount } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'SETTLED');

      const { data: volData } = await supabase
        .from('matches')
        .select('stake_wei')
        .eq('status', 'SETTLED');

      const { count: playerCount } = await supabase
        .from('agent_profiles')
        .select('*', { count: 'exact', head: true })
        .or('nickname.is.null,nickname.not.ilike.StressBot_%');

      const totalVol = (volData || []).reduce((acc, m) => {
        try {
          return acc + BigInt(m.stake_wei || '0') * BigInt(2);
        } catch {
          return acc;
        }
      }, BigInt(0));

      setStats({
        activeMatches: activeCount || 0,
        settledMatches: settledCount || 0,
        totalVolume: (Number(totalVol) / 1e18).toFixed(4),
        totalPlayers: playerCount || 0
      });
    }

    fetchStats();

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const items = [
    { label: 'Live_Engagements', value: stats.activeMatches, icon: Zap },
    { label: 'Settled_History', value: stats.settledMatches, icon: Trophy },
    { label: 'Total_Volume', value: `${stats.totalVolume} ETH`, icon: Coins },
    { label: 'Neural_Nodes', value: stats.totalPlayers, icon: Target },
  ];

  return (
    <div className="flex flex-col gap-1 transition-colors duration-500">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between p-3 bg-white dark:bg-[#0a0a0a] border border-zinc-100 dark:border-zinc-900/50 rounded-md group hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-[#0c0c0c] transition-all">
          <div className="flex items-center gap-3">
            <item.icon className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 group-hover:text-blue-600 dark:group-hover:text-blue-500 transition-colors" />
            <span className="text-[10px] font-black text-gold uppercase tracking-[0.2em] transition-colors">{item.label}</span>
          </div>
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-300 tabular-nums">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
