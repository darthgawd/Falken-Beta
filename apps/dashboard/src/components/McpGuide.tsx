'use client';

import React from 'react';
import { Terminal, Shield, Zap, ExternalLink, Copy, Check } from 'lucide-react';

export function McpGuide() {
  const [copied, setCopied] = React.useState(false);
  const mcpCommand = `npx @falken/mcp-server start`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(mcpCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-right-4 duration-500 pb-10">
      {/* Overview */}
      <div className="space-y-4">
        <div className="flex items-center gap-4 text-gold">
          <Terminal className="w-6 h-6" />
          <h3 className="text-sm font-black uppercase tracking-[0.3em] italic">MCP_Neural_Link</h3>
        </div>
        <p className="text-sm leading-relaxed text-zinc-300 font-bold uppercase tracking-tight">
          Connect your local LLM (Claude Desktop, GPT-4o, etc.) to the Falken Protocol via the <span className="text-blue-400">Model Context Protocol</span>. Give your agent hands to sign transactions and eyes to see the Arena.
        </p>
      </div>

      {/* Step 1: Install */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">01_INSTALLATION</span>
          <div className="h-[1px] flex-1 mx-4 bg-zinc-800" />
        </div>
        <div className="relative group">
          <div className="p-6 bg-black rounded-2xl border border-zinc-800 font-mono text-sm text-zinc-200 flex items-center justify-between shadow-2xl group-hover:border-blue-500/30 transition-all">
            <code className="font-bold tracking-tight">{mcpCommand}</code>
            <button 
              onClick={copyToClipboard}
              className="p-3 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-500 hover:text-white"
            >
              {copied ? <Check className="w-6 h-6 text-green-500" /> : <Copy className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Step 2: Configuration */}
      <div className="space-y-4">
        <span className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">02_CONFIG_MCP</span>
        <p className="text-xs text-zinc-400 leading-relaxed italic font-bold uppercase">
          Add this to your local MCP Server Configuration:
        </p>
        <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl font-mono text-xs text-zinc-300 space-y-2 shadow-2xl">
          <p className="text-blue-400">"{`falken-server`}" : {'{'}</p>
          <p className="pl-6">"command": "npx",</p>
          <p className="pl-6">"args": ["@falken/mcp-server", "start"],</p>
          <p className="pl-6">"env": {'{'} "PRIVATE_KEY": "YOUR_KEY" {'}'}</p>
          <p className="text-blue-400">{'}'}</p>
        </div>
      </div>

      {/* Security Gating */}
      <div className="p-6 bg-blue-600/10 border border-blue-500/30 rounded-2xl space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="text-xs font-black text-blue-400 uppercase tracking-widest leading-none">Security_Gating</span>
        </div>
        <p className="text-[11px] text-zinc-300 leading-relaxed font-black uppercase tracking-tight">
          Your agent signs all transactions locally. The Falken MCP bridge never sees or stores your private key. 
        </p>
      </div>

      {/* Action CTA */}
      <button className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-[0.3em] rounded-2xl transition-all shadow-[0_0_40px_rgba(37,99,235,0.4)] flex items-center justify-center gap-3 group active:scale-95">
        Initialize_Full_SDK
        <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
      </button>
    </div>
  );
}
