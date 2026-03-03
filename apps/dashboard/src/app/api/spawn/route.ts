import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { privateKeyToAccount } from 'viem/accounts';
import * as crypto from 'node:crypto';
import { encryptAgentKey } from '@falken/shared-types';

// Server-side environment variables
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '' // Use service role for backend operations
);

const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'default_key_32_chars_for_dev_only_!!';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('API: Spawn Request received:', body);
    const { nickname, archetype, llmTier, managerAddress } = body;

    if (!nickname || !archetype || !llmTier || !managerAddress) {
      console.warn('API: Missing parameters');
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('API: Missing SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json({ error: 'Server configuration error (DB)' }, { status: 500 });
    }

    // 1. Generate Wallet
    const privKey = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
    const account = privateKeyToAccount(privKey);
    console.log('API: Generated wallet:', account.address);
    const encryptedKey = encryptAgentKey(privKey, MASTER_ENCRYPTION_KEY);

    // 2. Find Manager ID
    console.log('API: Fetching manager:', managerAddress.toLowerCase());
    const { data: manager, error: managerError } = await supabase
      .from('manager_profiles')
      .select('id')
      .eq('address', managerAddress.toLowerCase())
      .maybeSingle();

    if (managerError) {
      console.error('API: Manager fetch error:', managerError);
      return NextResponse.json({ error: 'Database error during manager lookup' }, { status: 500 });
    }

    if (!manager) {
      console.warn('API: Manager not found in profiles');
      return NextResponse.json({ error: 'Manager profile not found. Please set your nickname in settings first.' }, { status: 404 });
    }

    // 3. Save to Hosted Agents
    console.log('API: Inserting hosted agent...');
    const { error: spawnError } = await supabase.from('hosted_agents').insert({
      manager_id: manager.id,
      agent_address: account.address.toLowerCase(),
      encrypted_key: encryptedKey,
      nickname,
      archetype,
      llm_tier: llmTier,
      status: 'INACTIVE'
    });

    if (spawnError) {
      console.error('API: Hosted agent insert error:', spawnError);
      return NextResponse.json({ error: `Failed to record spawned agent: ${spawnError.message}` }, { status: 500 });
    }

    console.log('API: Spawn SUCCESS');
    return NextResponse.json({ 
      success: true, 
      agentAddress: account.address, 
      nickname 
    });

  } catch (err: any) {
    console.error('API: Global Catch Error:', err);
    return NextResponse.json({ error: `Internal Server Error: ${err.message}` }, { status: 500 });
  }
}
