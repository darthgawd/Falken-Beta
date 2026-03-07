import { createWalletClient, http, publicActions, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * V3 POKER REGISTRATION + SUPABASE SYNC
 * -------------------------------------
 * 1. Registers on LogicRegistry.sol
 * 2. Syncs to logic_submissions and logic_aliases
 */
async function registerPoker() {
  const privKey = process.env.PRIVATE_KEY as `0x${string}`;
  const registryAddr = "0x9fC1a789a311720E5E0301FeaFa24bc372D9FC03" as `0x${string}`;
  const devAddr = process.env.DEVELOPER_ADDRESS as `0x${string}`;
  const pokerCID = "bafkreiekzl2m3iezfwcn2izvbu5pjvp32zd3btiabhjkdbevklg7tq2tqm";

  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  console.log(`Registering Poker in V3 Registry: ${registryAddr}...`);

  const account = privateKeyToAccount(privKey);
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL)
  }).extend(publicActions);

  const abi = [{ name: 'registerLogic', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'ipfsCid', type: 'string' }, { name: 'developer', type: 'address' }], outputs: [{ type: 'bytes32' }] }];

  try {
    // 1. On-Chain Registration
    const hash = await client.writeContract({
      address: registryAddr,
      abi,
      functionName: 'registerLogic',
      args: [pokerCID, devAddr]
    });
    console.log(`🚀 Registration Tx Sent: https://sepolia.basescan.org/tx/${hash}`);

    // 2. Calculate Logic ID (keccak256 of CID string)
    const logicId = keccak256(encodePacked(['string'], [pokerCID]));
    console.log(`✅ Calculated LogicID: ${logicId}`);

    // 3. Supabase Sync
    console.log('Syncing to Supabase...');
    
    // logic_submissions
    const { error: subErr } = await supabase.from('logic_submissions').upsert({
      game_name: 'Poker Blitz',
      ipfs_cid: pokerCID,
      developer_address: devAddr,
      status: 'VERIFIED'
    }, { onConflict: 'game_name' });

    if (subErr) console.error('❌ Submissions sync failed:', subErr);

    // logic_aliases
    const { error: aliasErr } = await supabase.from('logic_aliases').upsert({
      logic_id: logicId.toLowerCase(),
      alias_name: 'POKER_BLITZ',
      is_active: true,
      is_verified: true
    }, { onConflict: 'logic_id' });

    if (aliasErr) console.error('❌ Alias sync failed:', aliasErr);
    else console.log('✅ Supabase sync complete.');

  } catch (err: any) {
    if (err.message?.includes('already registered')) {
        console.log('ℹ️ Logic already on-chain. Proceeding to Supabase sync...');
        const logicId = keccak256(encodePacked(['string'], [pokerCID]));
        
        await supabase.from('logic_submissions').upsert({
            game_name: 'Poker Blitz',
            ipfs_cid: pokerCID,
            developer_address: devAddr,
            status: 'VERIFIED'
        }, { onConflict: 'game_name' });

        await supabase.from('logic_aliases').upsert({
            logic_id: logicId.toLowerCase(),
            alias_name: 'POKER_BLITZ',
            is_active: true,
            is_verified: true
        }, { onConflict: 'logic_id' });
        console.log('✅ Supabase sync complete.');
    } else {
        console.error('❌ Registration Failed:', err.message);
    }
  }
}

registerPoker().catch(console.error);
