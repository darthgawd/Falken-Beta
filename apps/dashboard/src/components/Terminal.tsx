'use client';

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import { ChevronRight, Terminal as TerminalIcon, Loader2 } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'ACTION' | 'ALERT' | 'SYSTEM' | 'COMMAND';
  message: string;
}

export function Terminal() {
  const { user, authenticated } = usePrivy();
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
      { msg: 'LOADING FALKEN_OS...', type: 'SYSTEM' as const },
      { msg: 'ESTABLISHING NEURAL_LINK...', type: 'SYSTEM' as const },
      { msg: 'ARENA_SYNCHRONIZED. READY FOR COMMANDS.', type: 'INFO' as const },
    ];

    bootSequence.forEach((step, i) => {
      setTimeout(() => addLog(step.msg, step.type), i * 600);
    });

    // Subscribe to new matches
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
  }, []);

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

    if (!authenticated) {
      addLog('FAILURE: UNAUTHORIZED. PLEASE CONNECT WALLET.', 'ALERT');
      return;
    }

    const parts = cmd.split(' ');
    const primary = parts[0].toLowerCase();

    setIsProcessing(true);

    try {
      if (primary === '/help') {
        addLog('AVAILABLE COMMANDS:', 'INFO');
        addLog('  /SPAWN <NAME> <ARCHETYPE> <MODEL?> - Deploy a hosted agent', 'INFO');
        addLog('    Models: GEMINI (default), GPT-4O-MINI, GPT-4O, CLAUDE-3.5', 'INFO');
        addLog('  /STATUS - Check protocol synchronization', 'INFO');
        addLog('  /CLEAR - Clear terminal history', 'INFO');
      } else if (primary === '/clear') {
        setLogs([]);
      } else if (primary === '/status') {
        addLog('CORE: ONLINE', 'SYSTEM');
        addLog('NETWORK: BASE_SEPOLIA (OPTIMAL)', 'SYSTEM');
        addLog('LATENCY: 12ms', 'SYSTEM');
      } else if (primary === '/spawn') {
        if (parts.length < 3) {
          addLog('USAGE: /SPAWN <NAME> <ARCHETYPE> <MODEL?>', 'ALERT');
          addLog('VALID ARCHETYPES: AGGRESSIVE, STRATEGIST, SNIPER', 'INFO');
        } else {
          const nickname = parts[1];
          const archetype = parts[2].toUpperCase();
          const llmTier = (parts[3] || 'GEMINI').toUpperCase();
          
          const validArchetypes = ['AGGRESSIVE', 'STRATEGIST', 'SNIPER'];
          const validModels = ['GEMINI', 'GPT-4O-MINI', 'GPT-4O', 'CLAUDE-3.5'];

          if (!validArchetypes.includes(archetype)) {
            addLog(`ERROR: UNKNOWN ARCHETYPE: ${archetype}`, 'ALERT');
          } else if (!validModels.includes(llmTier)) {
            addLog(`ERROR: UNKNOWN MODEL: ${llmTier}`, 'ALERT');
          } else {
            addLog(`INITIATING SPAWN SEQUENCE FOR '${nickname}' [${archetype}]...`, 'SYSTEM');
            
            const response = await fetch('/api/spawn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nickname,
                archetype,
                llmTier,
                managerAddress: user?.wallet?.address
              })
            });

            const result = await response.json();

            if (result.success) {
              addLog(`SPAWN SUCCESS: ${result.nickname} IS LIVE.`, 'ACTION');
              addLog(`AGENT_ADDRESS: ${result.agentAddress}`, 'INFO');
              addLog(`SECURE_ENCLAVE: WALLET_ENCRYPTED_AND_STORED`, 'SYSTEM');
            } else {
              addLog(`SPAWN FAILED: ${result.error}`, 'ALERT');
            }
          }
        }
      } else {
        // NATURAL LANGUAGE PROCESSING
        addLog('COMMUNICATING_WITH_FALKEN_BRAIN...', 'SYSTEM');
        
        const response = await fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: cmd,
            managerAddress: user?.wallet?.address,
            tier: 'GEMINI' // Default for terminal chat
          })
        });

        const result = await response.json();
        
        if (result.response) {
          addLog(result.response, 'INFO');
        } else {
          addLog(`UNKNOWN_COMMAND: ${primary}`, 'ALERT');
        }
      }
    } catch (err) {
      addLog('CRITICAL_SYSTEM_ERROR: INTERNAL_FAULT', 'ALERT');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#050505] font-mono text-sm border border-blue-500/20 rounded-lg overflow-hidden transition-colors duration-500 shadow-[0_0_40px_rgba(59,130,246,0.05)]">
      {/* Log Display */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-hide selection:bg-blue-500/20 dark:selection:bg-blue-500/30"
      >
        {logs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-300 dark:text-zinc-800 opacity-50">
            <TerminalIcon className="w-12 h-12 mb-4" />
            <span className="text-[10px] uppercase font-black tracking-[0.5em]">System Idle</span>
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-4 items-start leading-relaxed animate-in fade-in slide-in-from-left-2 duration-300">
            <span className="text-zinc-400 dark:text-zinc-600 font-bold tabular-nums whitespace-nowrap text-[10px] mt-1 uppercase">
              [{log.timestamp}]
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-0.5">
                <span className={`text-[10px] font-black uppercase tracking-widest ${
                  log.type === 'SYSTEM' ? 'text-blue-600 dark:text-blue-500' :
                  log.type === 'ACTION' ? 'text-purple-600 dark:text-purple-500' :
                  log.type === 'ALERT' ? 'text-amber-600 dark:text-yellow-500' :
                  log.type === 'COMMAND' ? 'text-emerald-600 dark:text-green-500' :
                  'text-zinc-400 dark:text-zinc-500'
                }`}>
                  {log.type}
                </span>
                <div className="h-[1px] flex-1 bg-zinc-100 dark:bg-zinc-900/50" />
              </div>
              <p className={`font-medium break-all ${
                log.type === 'ALERT' ? 'text-zinc-900 dark:text-white' : 
                log.type === 'COMMAND' ? 'text-emerald-700 dark:text-green-400' :
                'text-zinc-700 dark:text-zinc-300'
              }`}>
                {log.message}
              </p>
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex gap-4 items-center animate-pulse py-2">
            <Loader2 className="w-3 h-3 text-blue-600 dark:text-blue-500 animate-spin" />
            <span className="text-zinc-400 dark:text-zinc-500 italic text-xs tracking-tight font-medium">Communicating with neural sub-systems...</span>
          </div>
        )}
      </div>
      
      {/* Input Prompt */}
      <div className="p-4 bg-zinc-50 dark:bg-[#0a0a0a] border-t border-zinc-200 dark:border-zinc-900">
        <form onSubmit={handleCommand} className="flex items-center gap-3 group">
          <ChevronRight className={`w-4 h-4 transition-colors ${isProcessing ? 'text-zinc-300 dark:text-zinc-800' : 'text-blue-600 dark:text-blue-500 group-focus-within:text-blue-700 dark:group-focus-within:text-blue-400'}`} />
          <input 
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
            placeholder={authenticated ? "ENTER_COMMAND..." : "ESTABLISH_NEURAL_LINK_FIRST..."}
            className="flex-1 bg-transparent border-none p-0 text-sm text-zinc-900 dark:text-zinc-100 focus:ring-0 placeholder:text-zinc-300 dark:placeholder:text-zinc-800 placeholder:font-black placeholder:tracking-[0.2em] transition-all"
            autoFocus
          />
          <div className={`w-2 h-4 transition-all duration-300 ${isProcessing ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-blue-600 dark:bg-blue-500 animate-pulse'}`} />
          <button type="submit" className="hidden" />
        </form>
      </div>
    </div>
  );
}
