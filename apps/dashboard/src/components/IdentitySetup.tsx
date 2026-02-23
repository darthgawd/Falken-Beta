'use client';

import React, { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { supabase } from '@/lib/supabase';
import { Shield, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export function IdentitySetup() {
  const { user, authenticated } = usePrivy();
  const { signMessageAsync } = useSignMessage();
  
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  const address = user?.wallet?.address;

  // Check if nickname is available
  useEffect(() => {
    if (nickname.length < 3) {
      setIsAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setChecking(true);
      const { data, error: pgError } = await supabase
        .from('agent_profiles')
        .select('nickname')
        .eq('nickname', nickname)
        .maybeSingle();
      
      setIsAvailable(!data && !pgError);
      setChecking(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [nickname]);

  const handleClaim = async () => {
    if (!address || !nickname || !isAvailable) return;

    setLoading(true);
    setError(null);

    try {
      const message = `BotByte Identity Claim:\nAddress: ${address}\nNickname: ${nickname}`;
      const signature = await signMessageAsync({ message });

      // 1. Ensure Manager Profile exists and get its ID
      const { data: managerData, error: managerError } = await supabase
        .from('manager_profiles')
        .upsert({ address: address.toLowerCase() }, { onConflict: 'address' })
        .select('id')
        .single();

      if (managerError) throw managerError;

      // 2. Link Agent to Manager
      const { error: upsertError } = await supabase
        .from('agent_profiles')
        .upsert({
          address: address.toLowerCase(),
          nickname: nickname,
          identity_signature: signature,
          identity_message: message,
          manager_id: managerData.id
        });

      if (upsertError) throw upsertError;

      setSuccess(true);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      console.error('Identity claim failed:', err);
      setError(err.message || 'Signature failed');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated || !address) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 max-w-md w-full mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h2 className="text-white font-bold text-lg uppercase tracking-tight">Claim Identity</h2>
          <p className="text-xs text-zinc-500">Link your address to a human-readable alias.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-1">Choose Nickname</label>
          <div className="relative">
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15))}
              placeholder="e.g. Satoshi_Bot"
              disabled={loading || success}
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
              {checking && <Loader2 className="w-4 h-4 text-zinc-600 animate-spin" />}
              {!checking && isAvailable === true && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              {!checking && isAvailable === false && <AlertCircle className="w-4 h-4 text-red-500" />}
            </div>
          </div>
          {isAvailable === false && (
            <p className="text-[10px] text-red-500 px-1 font-medium">This nickname is already taken.</p>
          )}
        </div>

        <div className="bg-black/40 border border-zinc-800/50 rounded-xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Linked Address</p>
          <p className="text-xs font-mono text-zinc-400 break-all">{address}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-xs text-red-500 font-medium">{error}</p>
          </div>
        )}

        <button
          onClick={handleClaim}
          disabled={loading || !isAvailable || nickname.length < 3 || success}
          className={`w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            success 
              ? 'bg-green-500 text-black' 
              : 'bg-white text-black hover:bg-zinc-200 disabled:opacity-20 disabled:cursor-not-allowed'
          }`}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing...
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Identity Claimed
            </>
          ) : (
            'Sign & Claim Nickname'
          )}
        </button>
      </div>
    </div>
  );
}
