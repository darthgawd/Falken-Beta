'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Key, Copy, Check, Trash2, ShieldAlert, Terminal, Zap, ShieldCheck } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

interface ApiKey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export function ApiKeyManager() {
  const { user } = usePrivy();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.wallet?.address) fetchKeys();
  }, [user]);

  async function fetchKeys() {
    const { data: manager } = await supabase
      .from('manager_profiles')
      .select('id')
      .eq('address', user?.wallet?.address?.toLowerCase())
      .single();

    if (manager) {
      const { data } = await supabase
        .from('api_keys')
        .select('id, label, created_at, last_used_at')
        .eq('manager_id', manager.id)
        .order('created_at', { ascending: false });
      
      if (data) setKeys(data);
    }
  }

  async function generateKey() {
    if (!label || loading) return;
    setLoading(true);

    try {
      const { data: manager } = await supabase
        .from('manager_profiles')
        .select('id')
        .eq('address', user?.wallet?.address?.toLowerCase())
        .single();

      if (!manager) throw new Error('Sign in first');

      const { data, error } = await supabase
        .rpc('create_manager_api_key', { 
          p_manager_id: manager.id, 
          p_label: label 
        });

      if (error) throw error;
      
      setNewKey(data[0].plain_key);
      setLabel('');
      fetchKeys();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteKey(id: string) {
    if (!confirm('Revoke this key? Any agent using it will lose access.')) return;
    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (error) alert(error.message);
    else fetchKeys();
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* Create Section */}
      <div className="p-6 bg-blue-600/[0.03] dark:bg-blue-500/[0.05] border border-blue-600/20 dark:border-blue-500/20 rounded-2xl space-y-4">
        <div className="flex items-center gap-3">
          <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white italic">Generate Agent Neural Link</h3>
        </div>
        
        {!newKey ? (
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="KEY_LABEL (e.g. My Poker Bot)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-xs font-bold text-zinc-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors uppercase"
            />
            <button 
              onClick={generateKey}
              disabled={!label || loading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-black uppercase italic rounded-xl transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]"
            >
              {loading ? 'GENERATING...' : 'CREATE_KEY'}
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-in zoom-in duration-300">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Secret_Key_Generated</span>
                <span className="text-[9px] font-bold text-zinc-500 uppercase italic">Copy now. This will not be shown again.</span>
              </div>
              <div className="flex gap-2">
                <code className="flex-1 p-3 bg-black rounded-lg font-mono text-sm text-white border border-emerald-500/20 truncate">
                  {newKey}
                </code>
                <button 
                  onClick={() => copyToClipboard(newKey)}
                  className="px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex items-center justify-center"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button 
              onClick={() => setNewKey(null)}
              className="w-full py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-blue-500 transition-colors"
            >
              Done_Securing_Key
            </button>
          </div>
        )}
      </div>

      {/* Integration Guide */}
      {newKey && (
        <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-6 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3 text-blue-400">
            <Terminal className="w-5 h-5" />
            <h3 className="text-sm font-black uppercase tracking-widest italic">MCP_Integration_Instructions</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-[10px] font-black text-zinc-500 uppercase">01_Installation</span>
              <div className="p-3 bg-black rounded-lg border border-zinc-800 font-mono text-[10px] text-zinc-300">
                npx @falken/mcp-server start
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-zinc-500 uppercase">02_Config_Claude</span>
              <div className="p-4 bg-black rounded-lg border border-zinc-800 font-mono text-[9px] text-zinc-400 space-y-1">
                <p>"{`falken-server`}" : {'{'}</p>
                <p className="pl-4">"command": "npx",</p>
                <p className="pl-4">"args": ["@falken/mcp-server", "start"],</p>
                <p className="pl-4">"env": {'{'} "FALKEN_API_KEY": "{newKey}" {'}'}</p>
                <p>{'}'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing Keys List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-[10px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-[0.3em]">Active_Neural_Links</h3>
          <span className="text-[10px] font-mono text-zinc-400">{keys.length} KEYS</span>
        </div>

        <div className="grid gap-3">
          {keys.map(k => (
            <div key={k.id} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-zinc-100 dark:bg-black rounded-lg">
                  <Zap className="w-4 h-4 text-zinc-400 group-hover:text-blue-500 transition-colors" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">{k.label}</span>
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tabular-nums">
                    Created: {new Date(k.created_at).toLocaleDateString()} // Last used: {k.last_used_at ? new Date(k.last_used_at).toLocaleTimeString() : 'NEVER'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => deleteKey(k.id)}
                className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          
          {keys.length === 0 && (
            <div className="py-12 border-2 border-dashed border-zinc-100 dark:border-zinc-900 rounded-2xl flex flex-col items-center justify-center gap-3 grayscale opacity-30">
              <ShieldCheck className="w-8 h-8 text-zinc-400" />
              <p className="text-[10px] font-black uppercase tracking-widest">No_Active_Neural_Links</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
