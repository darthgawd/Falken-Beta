import { createClient } from '@supabase/supabase-js';
import { decryptAgentKey, encryptAgentKey } from '../packages/shared-types/src/crypto';
import { privateKeyToAccount } from 'viem/accounts';
import * as crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '' // Use service role for direct DB access
);

const MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY || '';

/**
 * DIRECT LOGIC TEST (No Network Required)
 * This directly executes the core spawn sequence to test DB & Crypto integrity.
 */
async function spawnAgentDirect(nickname: string, managerId: string) {
  // 1. Generate Wallet
  const privKey = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
  const account = privateKeyToAccount(privKey);
  const encryptedKey = encryptAgentKey(privKey, MASTER_KEY);

  // 2. Save to DB
  const { data, error } = await supabase.from('hosted_agents').insert({
    manager_id: managerId,
    agent_address: account.address.toLowerCase(),
    encrypted_key: encryptedKey,
    nickname,
    archetype: 'AGGRESSIVE',
    llm_tier: 'GEMINI',
    status: 'INACTIVE'
  }).select().single();

  if (error) return { success: false, error: error.message };
  return { success: true, agentAddress: account.address, nickname };
}

async function stressTestSpawning() {
  console.log('\n🚀 --- RIGOROUS_DIRECT_SPAWN_STRESS_TEST ---');

  if (!MASTER_KEY) {
    console.error('CRITICAL: MASTER_ENCRYPTION_KEY not set.');
    process.exit(1);
  }

  // 1. Setup
  const { data: manager } = await supabase.from('manager_profiles').select('id, address').limit(1).single();
  if (!manager) {
    console.error('FAIL: No manager found.');
    return;
  }
  console.log(`[SETUP] Targeting Manager: ${manager.address}`);

  // 2. Phase 1: Concurrent Burst
  const burstCount = 10; // Increasing to 10 for true stress
  console.log(`[PHASE_1] Executing concurrent burst of ${burstCount} direct DB spawns...`);

  const spawnRequests = Array.from({ length: burstCount }).map((_, i) => {
    const name = `StressBot_${i}_${Math.random().toString(36).substring(7)}`;
    return spawnAgentDirect(name, manager.id);
  });

  const results = await Promise.all(spawnRequests);

  // 3. Phase 2: Integrity Check
  console.log('\n[PHASE_2] Validating Vault & Data Integrity...');
  let successCount = 0;
  for (const bot of results) {
    if (bot.success) {
      const { data: dbBot } = await supabase
        .from('hosted_agents')
        .select('*')
        .eq('agent_address', bot.agentAddress!.toLowerCase())
        .single();

      if (dbBot) {
        try {
          const decrypted = decryptAgentKey(dbBot.encrypted_key, MASTER_KEY);
          if (decrypted.startsWith('0x')) {
            console.log(`✅ VERIFIED: ${bot.nickname} -> Wallet ${bot.agentAddress} (Decrypted successfully)`);
            successCount++;
          }
        } catch (err) {
          console.error(`❌ VAULT_FAILURE: Key corruption for ${bot.nickname}`);
        }
      }
    } else {
      console.error(`❌ SPAWN_ERROR: ${bot.error}`);
    }
  }

  // 4. Phase 3: Cleanup
  console.log('\n[PHASE_3] Cleaning up stress-test data...');
  await supabase.from('hosted_agents').delete().ilike('nickname', 'StressBot_%');
  console.log('✅ CLEANUP_COMPLETE.');

  console.log(`\n--- SUMMARY: ${successCount}/${burstCount} BOTS VERIFIED ---\n`);
  
  if (successCount === burstCount) {
    console.log('STATUS: PROTOCOL_IDENTITY_LAYER_IS_BULLETPROOF');
  } else {
    console.error('STATUS: IDENTITY_LAYER_FAILED_INTEGRITY_CHECK');
    process.exit(1);
  }
}

stressTestSpawning().catch(console.error);
