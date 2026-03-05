'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, usePublicClient } from 'wagmi';
import { Wallet, Cpu, Zap, Activity, Shield, ExternalLink, Loader2, RefreshCcw, Terminal, Terminal as TerminalIcon, Copy, CheckCircle2 } from 'lucide-react';
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
  const [copied, setCopied] = useState(false);

  async function fetchAgentData() {
    if (!activeAddress) {
      setLoading(false);
      return;
    }

    try {
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

      const { data: agentData, error: aErr } = await supabase
        .from('hosted_agents')
        .select('*')
        .eq('manager_id', manager.id)
        .maybeSingle();

      if (aErr) throw aErr;
      if (agentData) {
        setAgent(agentData);
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
    const channel = supabase
      .channel('hosted-agent-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hosted_agents' }, () => {
        fetchAgentData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeAddress, publicClient]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAgentData();
  };

  const copyCommand = () => {
    navigator.clipboard.writeText('npx @falken/mcp-server');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-black/20 rounded-xl border border-zinc-900">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      </div>
    );
  }

  // MCP Connection Instructions (When no hosted agent or not logged in)
  if (!agent) {
    return (
      <div className="flex flex-col bg-[#080808] border border-zinc-800 rounded-xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="px-3 py-2 bg-purple-600/10 border-b border-purple-600/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3 text-purple-500" />
            <span className="text-[9px] font-black text-white uppercase tracking-widest leading-none italic">Neural_Link_Required</span>
          </div>
        </div>
        
        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Connect Your Bot</p>
            <p className="text-[11px] text-[#f5f5f5] leading-relaxed font-medium">
              Falken is a Bring-Your-Own-Bot (BYOB) arena. Connect your model via the MCP bridge to start competing.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-[8px] font-black text-zinc-600 uppercase tracking-[0.2em]">Terminal_Command</span>
            <div 
              onClick={copyCommand}
              className="group relative flex items-center justify-between bg-black border border-zinc-800 rounded-lg p-3 cursor-pointer hover:border-purple-500/50 transition-colors"
            >
              <code className="text-[10px] font-mono text-purple-400">npx @falken/mcp-server</code>
              {copied ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-zinc-700 group-hover:text-purple-500 transition-colors" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 bg-zinc-900/50 rounded border border-zinc-800/50">
              <span className="text-[8px] font-black text-zinc-600 uppercase block mb-1">Status</span>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Awaiting_Link</span>
            </div>
            <div className="p-2 bg-zinc-900/50 rounded border border-zinc-800/50">
              <span className="text-[8px] font-black text-zinc-600 uppercase block mb-1">Sector</span>
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">0xDEAD...BEEF</span>
            </div>
          </div>

          <div className="pt-2 border-t border-zinc-800/50 flex items-center justify-between">
            <a 
              href="/onboarding" 
              className="text-[9px] font-black text-blue-500 uppercase tracking-widest hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              Setup Guide <ExternalLink className="w-2 h-2" />
            </a>
            <span className="text-[8px] font-bold text-zinc-700 uppercase italic tabular-nums">v0.0.1_BETA</span>
          </div>
        </div>
      </div>
    );
  }

  // Active Agent View
  return (
    <div className="space-y-3 p-1">
      {/* Nickname & Archetype */}
      <div className="flex items-center justify-between px-2">
        <span className="text-sm font-black text-white uppercase italic tracking-tight">{agent.nickname}</span>
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full">
          <Activity className="w-2 h-2 text-purple-500" />
          <span className="text-[8px] font-bold text-purple-500 uppercase tracking-widest">{agent.archetype}</span>
        </div>
      </div>

      {/* Combined Stats Row */}
      <div className="grid grid-cols-12 gap-2 px-1">
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
      <div className="flex items-center justify-between px-2 pb-1">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest italic">READY</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">Matches: <span className="text-white">{agent.total_matches}</span></span>
          <button 
            onClick={handleRefresh}
            className={`p-0.5 hover:bg-white/5 rounded transition-colors ${refreshing ? 'animate-spin text-blue-500' : 'text-zinc-500'}`}
          >
            <RefreshCcw className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
