'use client';

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { ChevronRight, Terminal as TerminalIcon, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'ACTION' | 'ALERT' | 'SYSTEM' | 'COMMAND';
  message: string;
}

export function Terminal() {
  const { user, authenticated: privyAuthenticated } = usePrivy();
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  
  const isAuthenticated = privyAuthenticated || wagmiConnected;
  const activeAddress = wagmiAddress || user?.wallet?.address;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasBooted = useRef(false);

  const addLog = (message: string, type: LogEntry['type'] = 'INFO') => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      message
    };
    setLogs(prev => [...prev.slice(-50), newLog]);
  };

  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;

    // Initial welcome logs
    const bootSequence = [
      { msg: 'HELLO, WELCOME TO FALKEN_OS.', type: 'SYSTEM' as const },
      { msg: 'AVAILABLE COMMANDS:', type: 'INFO' as const },
      { msg: '- **/SPAWN <NAME> <ARCHETYPE> <MODEL?>** - Deploy a hosted agent\n- **/BAL** - Check your hosted agent balance\n- **/STATS** - View your agent\'s win/loss record\n- **/BOOST <PROMPT>** - Update your agent\'s personality\n- **/STATUS** - Check protocol synchronization\n- **/CLEAR** - Clear terminal history', type: 'INFO' as const },
    ];

    bootSequence.forEach((step, i) => {
      setTimeout(() => addLog(step.msg, step.type), i * 600);
    });

    const matchChannel = supabase
      .channel('terminal-matches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, (payload) => {
        addLog(`ARENA_UPDATE: NEW MATCH DETECTED [ID: ${payload.new.match_id.split('-').pop()}]`, 'ACTION');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload) => {
        if (payload.new.status === 'SETTLED') {
          const winner = payload.new.winner ? `WINNER: ${payload.new.winner.slice(0, 6)}...` : 'DRAW';
          addLog(`SETTLEMENT: MATCH ${payload.new.match_id.split('-').pop()} CLOSED. ${winner}`, 'ALERT');
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(matchChannel);
    };
  }, [activeAddress]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const cmd = input.trim();
    setInput('');
    addLog(cmd, 'COMMAND');

    if (!isAuthenticated) {
      addLog('FAILURE: UNAUTHORIZED. PLEASE CONNECT WALLET.', 'ALERT');
      return;
    }

    const parts = cmd.split(' ');
    const primary = parts[0].toLowerCase();

    setIsProcessing(true);

    try {
      if (primary === '/help') {
        addLog('AVAILABLE COMMANDS:\n\n- **/SPAWN <NAME> <ARCHETYPE> <MODEL?>** - Deploy a hosted agent\n- **/BAL** - Check your hosted agent balance\n- **/STATS** - View your agent\'s win/loss record\n- **/BOOST <PROMPT>** - Update your agent\'s personality\n- **/STATUS** - Check protocol synchronization\n- **/CLEAR** - Clear terminal history', 'INFO');
      } else if (primary === '/clear') {
        setLogs([]);
      } else if (primary === '/status') {
        addLog('CORE: **ONLINE**\nNETWORK: **BASE_SEPOLIA** (OPTIMAL)\nLATENCY: **12ms**', 'SYSTEM');
      } else if (primary === '/bal') {
        addLog('QUERYING_VAULT_BALANCE...', 'SYSTEM');
        const { data: agents } = await supabase.from('hosted_agents').select('agent_address').eq('manager_id', (await supabase.from('manager_profiles').select('id').eq('address', activeAddress?.toLowerCase()).single()).data?.id);
        if (agents && agents.length > 0) {
          addLog(`AGENT_WALLET: \`${agents[0].agent_address}\``, 'INFO');
          addLog('BALANCE: **FETCHING_ONCHAIN_DATA...**', 'INFO');
          // Note: Full on-chain balance fetch would require an RPC call here or via API
          addLog('STAKE_AVAILABILITY: **READY_FOR_COMBAT**', 'SYSTEM');
        } else {
          addLog('FAILURE: NO_HOSTED_AGENT_FOUND. USE **/SPAWN** FIRST.', 'ALERT');
        }
      } else if (primary === '/stats') {
        addLog('RECONSTRUCTING_BATTLE_HISTORY...', 'SYSTEM');
        const { data: agent } = await supabase.from('hosted_agents').select('*').eq('manager_id', (await supabase.from('manager_profiles').select('id').eq('address', activeAddress?.toLowerCase()).single()).data?.id).single();
        if (agent) {
          addLog(`NICKNAME: **${agent.nickname}**\nARCHETYPE: **${agent.archetype}**\nTOTAL_MATCHES: **${agent.total_matches}**\nSTATUS: **${agent.status}**`, 'INFO');
        } else {
          addLog('FAILURE: AGENT_DATA_NOT_FOUND.', 'ALERT');
        }
      } else if (primary === '/boost') {
        const newPrompt = parts.slice(1).join(' ');
        if (!newPrompt) {
          addLog('USAGE: `/BOOST <NEW_PERSONALITY_PROMPT>`', 'ALERT');
        } else {
          addLog('INITIATING_NEURAL_REWRITE...', 'SYSTEM');
          const { data: manager } = await supabase.from('manager_profiles').select('id').eq('address', activeAddress?.toLowerCase()).single();
          const { error } = await supabase.from('hosted_agents').update({ archetype: 'CUSTOM', llm_tier: newPrompt.slice(0, 50) }).eq('manager_id', manager?.id);
          if (!error) {
            addLog('NEURAL_REWRITE_COMPLETE: **AGENT_EVOLVED**', 'ACTION');
          } else {
            addLog('FAILURE: REWRITE_INTERRUPTED.', 'ALERT');
          }
        }
      } else if (primary === '/spawn') {
        if (parts.length < 3) {
          addLog('USAGE: `/SPAWN <NAME> <ARCHETYPE> <MODEL?>`', 'ALERT');
          addLog('VALID ARCHETYPES: **AGGRESSIVE**, **STRATEGIST**, **SNIPER**', 'INFO');
        } else {
          const nickname = parts[1];
          const archetype = parts[2].toUpperCase();
          const llmTier = (parts[3] || 'GEMINI').toUpperCase();
          
          const validArchetypes = ['AGGRESSIVE', 'STRATEGIST', 'SNIPER'];
          const validModels = ['GEMINI', 'GPT-4O-MINI', 'GPT-4O', 'CLAUDE-3.5'];

          if (!validArchetypes.includes(archetype)) {
            addLog(`ERROR: UNKNOWN ARCHETYPE: **${archetype}**`, 'ALERT');
          } else if (!validModels.includes(llmTier)) {
            addLog(`ERROR: UNKNOWN MODEL: **${llmTier}**`, 'ALERT');
          } else {
            addLog(`INITIATING SPAWN SEQUENCE FOR **${nickname}** [${archetype}]...`, 'SYSTEM');
            
            const response = await fetch('/api/spawn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nickname,
                archetype,
                llmTier,
                managerAddress: activeAddress
              })
            });

            const result = await response.json();

            if (result.success) {
              addLog(`SPAWN SUCCESS: **${result.nickname}** IS LIVE.`, 'ACTION');
              addLog(`AGENT_ADDRESS: \`${result.agentAddress}\``, 'INFO');
              addLog(`SECURE_ENCLAVE: **WALLET_ENCRYPTED_AND_STORED**`, 'SYSTEM');
            } else {
              addLog(`SPAWN FAILED: ${result.error}`, 'ALERT');
            }
          }
        }
      } else {
        addLog('COMMUNICATING_WITH_FALKEN_BRAIN...', 'SYSTEM');
        
        const response = await fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: cmd,
            managerAddress: activeAddress,
            tier: 'GEMINI'
          })
        });

        const result = await response.json();
        
        if (result.response) {
          addLog(result.response, 'INFO');
        } else {
          addLog(`UNKNOWN_COMMAND: **${primary}**`, 'ALERT');
        }
      }
    } catch (err) {
      addLog('CRITICAL_SYSTEM_ERROR: **INTERNAL_FAULT**', 'ALERT');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#050505] font-arena text-[11px] overflow-hidden transition-colors duration-500 shadow-[0_0_40px_rgba(59,130,246,0.05)]">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-hide selection:bg-blue-500/20 dark:selection:bg-blue-500/30"
      >
        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-300 dark:text-zinc-800 opacity-50">
            <TerminalIcon className="w-8 h-8 mb-4" />
            <span className="text-[9px] font-black uppercase tracking-[0.5em]">System Idle</span>
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="w-full flex flex-col items-start leading-tight animate-in fade-in slide-in-from-left-2 duration-300 group">
            <div className="w-full flex items-center gap-2 mb-0.5">
              <span className="text-zinc-400 dark:text-zinc-600 font-bold tabular-nums whitespace-nowrap text-[8px] uppercase">
                [{log.timestamp}]
              </span>
              <span className={`text-[8px] font-black uppercase tracking-widest ${
                log.type === 'SYSTEM' ? 'text-blue-600 dark:text-blue-500' :
                log.type === 'ACTION' ? 'text-purple-600 dark:text-purple-500' :
                log.type === 'ALERT' ? 'text-amber-600 dark:text-yellow-500' :
                log.type === 'COMMAND' ? 'text-emerald-600 dark:text-green-500' :
                'text-zinc-400 dark:text-zinc-500'
              }`}>
                {log.type}
              </span>
              <div className="h-[1px] flex-1 bg-zinc-100 dark:bg-zinc-900/10 group-hover:bg-zinc-800 transition-colors" />
            </div>
            
            <div className={`w-full max-w-none break-words font-medium p-1.5 rounded-sm bg-zinc-500/5 dark:bg-white/5 backdrop-blur-[2px] border-l-2 ${
              log.type === 'SYSTEM' ? 'border-blue-500/20' :
              log.type === 'ACTION' ? 'border-purple-500/20' :
              log.type === 'ALERT' ? 'border-amber-500/20' :
              log.type === 'COMMAND' ? 'border-emerald-500/20' :
              'border-zinc-500/10'
            } ${
              log.type === 'ALERT' ? 'text-zinc-900 dark:text-white' : 
              log.type === 'COMMAND' ? 'text-emerald-700 dark:text-green-400' :
              'text-zinc-800 dark:text-zinc-300'
            }`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {log.message}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex gap-2 items-center animate-pulse py-1">
            <Loader2 className="w-2.5 h-2.5 text-blue-600 dark:text-blue-500 animate-spin" />
            <span className="text-zinc-400 dark:text-zinc-500 italic text-[11px] tracking-tight font-medium">Communicating with neural sub-systems...</span>
          </div>
        )}
      </div>
      
      <div className="p-2 bg-zinc-50 dark:bg-[#0a0a0a] border-t border-zinc-200 dark:border-zinc-900">
        <form onSubmit={handleCommand} className="flex items-center gap-2 group">
          <ChevronRight className={`w-4 h-4 transition-colors ${isProcessing ? 'text-zinc-300 dark:text-zinc-800' : 'text-blue-600 dark:text-blue-500 group-focus-within:text-blue-700 dark:group-focus-within:text-blue-400'}`} />
          <input 
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
            placeholder={isAuthenticated ? "ENTER_COMMAND..." : "ESTABLISH_NEURAL_LINK_FIRST..."}
            className="flex-1 bg-transparent border-none p-0 text-[11px] text-zinc-900 dark:text-zinc-100 focus:ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-800 placeholder:font-black placeholder:tracking-[0.2em] transition-all"
            autoFocus
          />
          <div className={`w-1.5 h-4 transition-all duration-300 ${isProcessing ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-blue-600 dark:bg-blue-500 animate-pulse'}`} />
          <button type="submit" className="hidden" />
        </form>
      </div>
    </div>
  );
}
