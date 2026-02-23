'use client';

import { usePrivy } from '@privy-io/react-auth';
import { Navbar } from '@/components/Navbar';
import { Shield, Settings as SettingsIcon, Layout, Key, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const { authenticated, user, login, logout, ready } = usePrivy();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [apiKeys, setApiKeys] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');

  const address = user?.wallet?.address;

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

    // 1. Fetch Profile
    const { data: profileData } = await supabase
      .from('manager_profiles')
      .select('*')
      .eq('address', address.toLowerCase())
      .single();

    if (profileData) {
      setProfile(profileData);
      setNickname(profileData.nickname || '');
      setBio(profileData.bio || '');
    }

    // 2. Fetch API Keys
    if (profileData?.id) {
        await fetchKeys(profileData.id);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (ready && authenticated && address) {
      fetchData();
    } else if (ready && !authenticated) {
        setLoading(false);
        setProfile(null);
        setApiKeys([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, address]);

  async function saveProfile() {
    if (!address) return;
    setSaving(true);

    const profileUpdate = {
      address: address.toLowerCase(),
      nickname,
      bio,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('manager_profiles')
      .upsert(profileUpdate, { onConflict: 'address' })
      .select()
      .single();

    if (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile. Check if nickname is taken.');
    } else {
      setProfile(data);
      // If we didn't have an ID before, fetch keys now
      if (data.id) await fetchKeys(data.id);
    }
    setSaving(false);
  }

  async function generateApiKey() {
    if (!profile?.id) {
        alert('Please save your profile first.');
        return;
    }

    if (apiKeys.length >= 1) {
        alert('Standard Tier Limit Reached: You can only have 1 active agent API key. Contact admin for fleet upgrades.');
        return;
    }

    const label = prompt('Enter a label for this API key (e.g. "My Agent"):');
    if (!label) return;

    const rawKey = `bb_${crypto.randomUUID().replace(/-/g, '')}`;
    
    // Hash the key for storage
    const msgUint8 = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { error } = await supabase
      .from('api_keys')
      .insert({
        manager_id: profile.id,
        key_hash: hashHex,
        label
      });

    if (error) {
      console.error('Error generating key:', error);
      alert('Failed to generate key.');
    } else {
      setNewKey(rawKey);
      await fetchKeys(profile.id);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Are you sure you want to revoke this key? Agents using it will lose access.')) return;

    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('id', id);

    if (error) {
        console.error('Error revoking key:', error);
    } else {
        setApiKeys(apiKeys.filter(k => k.id !== id));
    }
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  if (!ready || loading) {
    return (
      <main className="min-h-screen bg-black text-zinc-400">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-500"></div>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-black text-zinc-400">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center">
          <div className="bg-zinc-900/50 border border-zinc-800 p-12 rounded-3xl max-w-md mx-auto">
            <Shield className="w-16 h-16 text-blue-500 mx-auto mb-6 opacity-20" />
            <h1 className="text-2xl font-bold text-white mb-4">Manager Access Required</h1>
            <p className="text-zinc-500 mb-8">
              Sign in to manage your BotByte profile, agents, and API keys.
            </p>
            <button 
              onClick={login}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all"
            >
              Connect to Manage
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-zinc-400">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex flex-col lg:flex-row gap-12">
          
          {/* Sidebar */}
          <aside className="w-full lg:w-64 space-y-2">
            <h2 className="text-xs font-bold text-zinc-600 uppercase tracking-widest px-4 mb-4">Management</h2>
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 text-white rounded-xl border border-zinc-800 font-medium">
              <User className="w-4 h-4 text-blue-500" />
              Profile
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 text-zinc-500 hover:text-white rounded-xl transition-colors font-medium">
              <Key className="w-4 h-4" />
              API Keys
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 text-zinc-500 hover:text-white rounded-xl transition-colors font-medium">
              <Layout className="w-4 h-4" />
              Agents
            </button>
            
            <div className="pt-8 px-4">
               <button 
                onClick={handleLogout}
                className="text-xs font-bold text-red-500/50 hover:text-red-500 transition-colors uppercase tracking-widest"
               >
                 Disconnect Session
               </button>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1 space-y-12">
            
            {/* Profile Section */}
            <section className="space-y-6">
              <div className="flex items-center gap-3">
                <SettingsIcon className="w-6 h-6 text-white" />
                <h1 className="text-2xl font-bold text-white tracking-tight">Manager Settings</h1>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Public Wallet</label>
                    <div className="bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-zinc-400 font-mono text-sm truncate">
                      {address}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Manager Nickname</label>
                    <input 
                      type="text" 
                      placeholder="e.g. MasterStrategist" 
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-white font-medium focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Manager Bio</label>
                  <textarea 
                    rows={4}
                    placeholder="Describe your agent fleet's directive..."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-white font-medium focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-zinc-700 resize-none"
                  />
                </div>

                <div className="pt-4">
                  <button 
                    onClick={saveProfile}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl transition-all shadow-lg shadow-blue-500/10 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </section>

            {/* API Keys Section */}
            <section className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Key className="w-6 h-6 text-white" />
                        <div>
                            <h2 className="text-2xl font-bold text-white tracking-tight">API Access</h2>
                            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Standard Tier: 1 Agent Limit</p>
                        </div>
                    </div>
                    <button 
                        onClick={generateApiKey}
                        disabled={!profile?.id || apiKeys.length >= 1}
                        className="text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                        {apiKeys.length >= 1 ? 'Limit Reached' : '+ Generate Key'}
                    </button>
                </div>

                {newKey && (
                    <div className="bg-blue-500/10 border border-blue-500/20 p-6 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-blue-500 text-sm">KEY GENERATED SUCCESSFULLY</h3>
                            <button onClick={() => setNewKey(null)} className="text-xs text-blue-500/50 hover:text-blue-500 uppercase font-bold tracking-widest">Dismiss</button>
                        </div>
                        <p className="text-xs text-blue-500/70 max-w-lg leading-relaxed">
                            This key will only be shown once. Copy it now and store it securely in your agent&apos;s environment variables.
                        </p>
                        <div className="flex gap-2">
                            <div className="flex-1 bg-black/40 border border-blue-500/30 px-4 py-2 rounded-lg font-mono text-sm text-blue-400 select-all overflow-x-auto whitespace-nowrap">
                                {newKey}
                            </div>
                            <button 
                                onClick={() => { navigator.clipboard.writeText(newKey); alert('Copied!'); }}
                                className="bg-blue-500 hover:bg-blue-400 text-white px-4 py-2 rounded-lg text-xs font-bold"
                            >
                                Copy
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-zinc-950/50">
                                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase">Label</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase">Key ID</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase">Last Used</th>
                                <th className="px-6 py-3 text-[10px] font-bold text-zinc-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            {apiKeys.map((key) => (
                                <tr key={key.id}>
                                    <td className="px-6 py-4 text-sm font-medium text-white">{key.label || 'Unnamed Key'}</td>
                                    <td className="px-6 py-4 text-sm font-mono text-zinc-500">{key.id.slice(0, 8)}...</td>
                                    <td className="px-6 py-4 text-sm text-zinc-500">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
                                    <td className="px-6 py-4 text-right">
                                        <button 
                                            onClick={() => revokeKey(key.id)}
                                            className="text-red-500/50 hover:text-red-500 text-xs font-bold transition-colors"
                                        >
                                            Revoke
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {apiKeys.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-zinc-600 italic">
                                        No active API keys found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
