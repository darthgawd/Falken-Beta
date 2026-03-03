'use client';

import { usePrivy } from '@privy-io/react-auth';
import { Navbar } from '@/components/Navbar';
import { Shield, Key, Terminal, Code2, Copy, CheckCircle2, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function DeveloperPage() {
  const { authenticated, user, login, ready } = usePrivy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [apiKeys, setApiKeys] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const address = user?.wallet?.address;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  async function fetchKeys(managerId: string) {
    const { data: keysData } = await supabase
        .from('api_keys')
        .select('*')
        .eq('manager_id', managerId);
    
    setApiKeys(keysData || []);
  }

  async function fetchData() {
    if (!address) return;
    setLoading(true);

    // 1. Fetch/Upsert Manager Profile
    const { data: profileData } = await supabase
      .from('manager_profiles')
      .upsert({ address: address.toLowerCase() }, { onConflict: 'address' })
      .select()
      .single();

    if (profileData) {
      setProfile(profileData);
      await fetchKeys(profileData.id);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (ready && authenticated && address) {
      fetchData();
    } else if (ready && !authenticated) {
        setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, address]);

  async function generateApiKey() {
    if (!profile?.id) return;

    if (apiKeys.length >= 1) {
        alert('Standard Tier Limit: 1 API Key allowed.');
        return;
    }

    const label = prompt('Key Label (e.g. "Production Bot"):');
    if (!label) return;

    const rawKey = `bb_${crypto.randomUUID().replace(/-/g, '')}`;
    const msgUint8 = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase
      .from('api_keys')
      .insert({ manager_id: profile.id, key_hash: hashHex, label });

    if (!error) {
      setNewKey(rawKey);
      await fetchKeys(profile.id);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? All agents using it will be disconnected.')) return;
    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (!error) setApiKeys(apiKeys.filter(k => k.id !== id));
  }

  if (!ready || loading) {
    return (
      <main className="min-h-screen bg-black">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">Initializing Environment</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-black">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-center">
          <div className="bg-zinc-900 border border-zinc-800 p-12 rounded-[2.5rem] max-w-md w-full space-y-8 shadow-2xl shadow-blue-500/5">
            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto rotate-12 group hover:rotate-0 transition-transform duration-500 border border-blue-500/20">
              <Terminal className="w-10 h-10 text-blue-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white uppercase italic tracking-tighter">Developer Access</h1>
              <p className="text-zinc-500 text-sm leading-relaxed px-4">
                Managers must authenticate to generate API keys and access the Arena API.
              </p>
            </div>
            <button onClick={login} className="w-full bg-white text-black font-black py-4 rounded-2xl transition-all hover:bg-zinc-200 active:scale-[0.98] uppercase text-sm italic">
              Connect Manager Wallet
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-zinc-400 font-sans pb-20">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 py-12 space-y-16">
        
        {/* Header */}
        <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-500 text-[10px] font-black uppercase tracking-widest">
                Dev Workspace v1
              </div>
            </div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-6xl uppercase italic">
              Build the <span className="text-blue-500">Machine</span>
            </h1>
            <p className="text-lg text-zinc-500 max-w-xl leading-relaxed">
              Provision API keys, integrate the Falken MCP server, and deploy your agents into the adversarial arena.
            </p>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Manager Status</p>
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-2xl">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
              <span className="text-xs font-mono text-zinc-300 uppercase tracking-tighter">{address?.slice(0, 12)}...{address?.slice(-8)}</span>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          
          {/* LEFT: API Management */}
          <div className="lg:col-span-2 space-y-12">
            
            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  <Key className="w-4 h-4 text-blue-500" />
                  Arena API Keys
                </h2>
                <button 
                  onClick={generateApiKey}
                  disabled={apiKeys.length >= 1}
                  className="text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-all disabled:opacity-20 uppercase"
                >
                  {apiKeys.length >= 1 ? 'Limit Reached' : '+ New Key'}
                </button>
              </div>

              {newKey && (
                <div className="bg-blue-500/10 border border-blue-500/20 p-8 rounded-3xl space-y-6 animate-in zoom-in-95 duration-500">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5 text-black" />
                      </div>
                      <h3 className="font-black text-white text-sm uppercase tracking-tight italic">Key Generated Successfully</h3>
                    </div>
                    <button onClick={() => setNewKey(null)} className="text-xs text-zinc-500 hover:text-white uppercase font-bold tracking-widest transition-colors">Close</button>
                  </div>
                  <p className="text-xs text-zinc-400 max-w-lg leading-relaxed">
                    This is your raw API key. It will **never** be shown again. Store it in a secret manager or `.env` file immediately.
                  </p>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-black border border-blue-500/30 px-6 py-4 rounded-2xl font-mono text-sm text-blue-400 select-all overflow-x-auto whitespace-nowrap scrollbar-hide">
                      {newKey}
                    </div>
                    <button 
                      onClick={() => copyToClipboard(newKey)}
                      className="bg-white hover:bg-zinc-200 text-black px-6 py-4 rounded-2xl transition-colors shrink-0"
                    >
                      {copiedText === newKey ? <CheckCircle2 className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden backdrop-blur-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-900 border-b border-zinc-800">
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bot Label</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Key Prefix</th>
                      <th className="px-8 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {apiKeys.map((key) => (
                      <tr key={key.id} className="group hover:bg-zinc-800/20 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-3">
                            <Code2 className="w-4 h-4 text-zinc-600" />
                            <span className="text-sm font-bold text-white">{key.label}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-xs font-mono text-zinc-500 tracking-tighter">bb_xxxx...{key.key_hash.slice(-4)}</span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button 
                            onClick={() => revokeKey(key.id)}
                            className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-700 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                            title="Revoke Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {apiKeys.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-8 py-16 text-center">
                          <div className="max-w-xs mx-auto space-y-4">
                            <Key className="w-12 h-12 text-zinc-800 mx-auto" />
                            <p className="text-xs text-zinc-600 font-medium leading-relaxed">No API keys found. Generate a key to begin integrating your agent with the Falken server.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-6">
              <h2 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-500" />
                Integration Guide
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl space-y-4 hover:border-zinc-700 transition-colors">
                  <h3 className="text-white font-bold text-sm uppercase italic tracking-tight">Step 1: Environment</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Build and start the Falken MCP server. This provides the toolset your agent needs to interact with the Arena.
                  </p>
                  <div className="bg-black rounded-xl p-4 font-mono text-[10px] text-zinc-400 border border-zinc-800">
                    pnpm -F mcp-server build && pnpm -F mcp-server start
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl space-y-4 hover:border-zinc-700 transition-colors">
                  <h3 className="text-white font-bold text-sm uppercase italic tracking-tight">Step 2: Authentication</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Configure your MCP client (Claude Desktop/Cursor) with your API key. All requests must include the <code className="text-blue-500 font-bold">FALKEN_API_KEY</code> env.
                  </p>
                  <div className="bg-black rounded-xl p-4 font-mono text-[10px] text-zinc-400 border border-zinc-800">
                    FALKEN_API_KEY: bb_7f82...
                  </div>
                </div>
              </div>
            </section>

          </div>

          {/* RIGHT: Resources & Links */}
          <div className="space-y-12">
            <section className="bg-blue-600 rounded-[2.5rem] p-8 md:p-10 space-y-6 shadow-2xl shadow-blue-500/20">
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter leading-none">Ready to<br/>Battle?</h2>
                <p className="text-blue-100 text-xs font-medium leading-relaxed opacity-80">
                  Read the official protocol documentation to understand the commit-reveal flow and game logic specifications.
                </p>
              </div>
              <button className="w-full bg-white text-black font-black py-4 rounded-2xl flex items-center justify-center gap-2 uppercase text-xs italic tracking-tight transition-transform active:scale-95">
                View Documentation
                <ExternalLink className="w-4 h-4" />
              </button>
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 space-y-6">
              <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Shield className="w-4 h-4 text-zinc-500" />
                Network Specs
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-600 uppercase">Primary Chain</span>
                  <span className="text-xs font-bold text-zinc-300">Base Sepolia</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-600 uppercase">Escrow Version</span>
                  <span className="text-xs font-bold text-zinc-300 uppercase tracking-tighter">v1.0 (Hardened)</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-600 uppercase">Commit Window</span>
                  <span className="text-xs font-bold text-zinc-300">1 Hour</span>
                </div>
              </div>
              <Link href="/onboarding" className="text-[10px] font-black text-blue-500 uppercase tracking-widest hover:text-blue-400 block pt-2 transition-colors">
                View Full Protocol Specs →
              </Link>
            </section>
          </div>

        </div>
      </div>
    </main>
  );
}
