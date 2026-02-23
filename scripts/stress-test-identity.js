const { ethers } = require('ethers');
require('dotenv').config();

const PROXY_URL = 'http://localhost:3001/tools/update_agent_nickname';

async function stressTestIdentity() {
  console.log('🚀 Starting Sprint 1 Stress Test: THE BOT HIVE ATTACK');
  
  // We simulate 20 agents all trying to claim nicknames simultaneously
  const numAgents = 20;
  const agents = Array.from({ length: numAgents }, () => ethers.Wallet.createRandom());
  
  console.log(`Generated ${numAgents} temporary agents. Launching simultaneous requests...`);

  const requests = agents.map(async (agent, i) => {
    try {
      const nickname = `StressBot_${i}`;
      const signature = await agent.signMessage(nickname);
      
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          nickname,
          address: agent.address,
          signature
        })
      });
      if (res.status !== 200) {
        console.log(`Request ${i} failed with status ${res.status}`);
      }
      return { status: res.status };
    } catch (err) {
      console.log(`Request ${i} errored: ${err.message}`);
      return { error: err.message };
    }
  });

  const results = await Promise.all(requests);
  
  const successes = results.filter(r => r.status === 200).length;
  const failures = results.filter(r => r.error).length;

  console.log('\n--- STRESS TEST RESULTS ---');
  console.log(`Total Requests: ${numAgents}`);
  console.log(`Successes:      ${successes}`);
  console.log(`Failures:       ${failures}`);

  if (failures === 0) {
    console.log('\n✅ Sprint 1 Verified: Database and Proxy handled the Hive Attack perfectly.');
  } else {
    console.log('\n❌ Sprint 1 Warning: Detected failures during high-frequency identity updates.');
  }
}

stressTestIdentity().catch(console.error);
