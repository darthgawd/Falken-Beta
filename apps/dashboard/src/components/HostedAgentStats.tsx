'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, usePublicClient } from 'wagmi';
import { Wallet, Cpu, Zap, Activity, Shield, ExternalLink, Loader2, RefreshCcw } from 'lucide-react';
import { formatEther } from 'viem';

interface HostedAgent {
  id: string;
  nickname: string;
  archetype: string;
  agent_address: string;
  status: string;
  total_matches: number;
}

export function HostedAgentStats() {
  const { user, authenticated } = usePrivy();
  const { address: wagmiAddress } = useAccount();
  const publicClient = usePublicClient();
  
  const activeAddress = wagmiAddress || user?.wallet?.address;
  const [agent, setAgent] = useState<HostedAgent | null>(null);
  const [balance, setBalance] = useState<string>('0.0000');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchAgentData() {
    if (!activeAddress) {
      setLoading(false);
      return;
    }

    try {
      // 1. Get Manager Profile
      const { data: manager, error: mErr } = await supabase
        .from('manager_profiles')
        .select('id')
        .eq('address', activeAddress.toLowerCase())
        .maybeSingle();

      if (mErr) throw mErr;
      if (!manager) {
        setLoading(false);
        return;
      }

      // 2. Get Hosted Agent
      const { data: agentData, error: aErr } = await supabase
        .from('hosted_agents')
        .select('*')
        .eq('manager_id', manager.id)
        .maybeSingle();

      if (aErr) throw aErr;
      if (agentData) {
        setAgent(agentData);
        
        // 3. Get On-chain Balance
        if (publicClient && agentData.agent_address) {
          const bal = await publicClient.getBalance({ 
            address: agentData.agent_address as `0x${string}` 
          });
          setBalance(parseFloat(formatEther(bal)).toFixed(4));
        }
      } else {
        setAgent(null);
      }
    } catch (err) {
      console.error('Error fetching agent stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchAgentData();
    
    // Subscribe to changes in hosted_agents
    const channel = supabase
      .channel('hosted-agent-updates')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'hosted_agents' 
      }, () => {
        fetchAgentData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeAddress, publicClient]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAgentData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-black/20 rounded-xl border border-zinc-900">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!authenticated || !agent) {
    return (
      <div className="p-6 bg-zinc-900/40 rounded-xl border border-zinc-800 flex flex-col items-center text-center gap-4">
        <Shield className="w-8 h-8 text-zinc-700" />
        <div className="space-y-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Deployment_Pending</span>
          <p className="text-xs text-zinc-600 font-medium">No hosted agent detected in this neural sector.</p>
        </div>
        {!authenticated ? (
          <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest italic">Connect wallet to view status</span>
        ) : (
          <span className="text-[9px] font-bold text-purple-500 uppercase tracking-widest italic">Use /SPAWN in the Command Hub</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-[#080808] border border-zinc-800 rounded-xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-3 h-3 text-blue-500" />
          <span className="text-[9px] font-black text-white uppercase tracking-widest leading-none italic">Telemetry</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest italic">Sector: 004</span>
          <button 
            onClick={handleRefresh}
            className={`p-0.5 hover:bg-white/5 rounded transition-colors ${refreshing ? 'animate-spin text-blue-500' : 'text-zinc-500'}`}
          >
            <RefreshCcw className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Nickname & Archetype */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-white uppercase italic tracking-tight">{agent.nickname}</span>
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full">
            <Activity className="w-2 h-2 text-purple-500" />
            <span className="text-[8px] font-bold text-purple-500 uppercase tracking-widest">{agent.archetype}</span>
          </div>
        </div>

        {/* Combined Stats Row */}
        <div className="grid grid-cols-12 gap-2">
          {/* Address - 7 cols */}
          <div className="col-span-7 p-2 bg-black rounded border border-zinc-900 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">ADDRESS</span>
              <a href={`https://sepolia.basescan.org/address/${agent.agent_address}`} target="_blank" rel="noopener noreferrer" className="text-zinc-700 hover:text-blue-500">
                <ExternalLink className="w-2 h-2" />
              </a>
            </div>
            <code className="text-[9px] font-mono text-zinc-400 truncate">
              {agent.agent_address}
            </code>
          </div>

          {/* Balance - 5 cols */}
          <div className="col-span-5 p-2 bg-blue-600/5 border border-blue-500/10 rounded flex flex-col gap-0.5">
            <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest text-center">ETH_BAL</span>
            <div className="flex items-baseline justify-center gap-0.5">
              <span className="text-sm font-black text-white tabular-nums">{balance}</span>
              <span className="text-[8px] font-bold text-zinc-500 uppercase">E</span>
            </div>
          </div>
        </div>

        {/* Quick Stats Ticker */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest italic">READY</span>
          </div>
          <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Matches: <span className="text-white">{agent.total_matches}</span></span>
        </div>
      </div>
    </div>
  );
}
