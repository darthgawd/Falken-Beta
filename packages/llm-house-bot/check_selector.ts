import { ethers } from 'ethers';

// Check what function this selector is
const selector = '0x3b47a640';
const signatures = [
  "getRoundStatus(uint256,uint8,address)",
  "getRoundStatus(uint256,uint256,address)",
  "roundCommits(uint256,uint256,address)",
  "getMatch(uint256)",
  "getPokerState(uint256)"
];

for (const sig of signatures) {
  const sigHash = ethers.id(sig).slice(0, 10);
  if (sigHash === selector) {
    console.log(`FOUND: ${sig} => ${sigHash}`);
  } else {
    console.log(`      ${sig} => ${sigHash}`);
  }
}
