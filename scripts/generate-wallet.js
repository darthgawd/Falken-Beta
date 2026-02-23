const { Wallet } = require('ethers');

// Generate a new random wallet
const wallet = Wallet.createRandom();

console.log('--- NEW WALLET GENERATED ---');
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);
console.log('--- IMPORTANT ---');
console.log('SAVE THIS PRIVATE KEY SECURELY. DO NOT SHARE IT.');
console.log('If you lose it, you lose access to your funds.');
console.log('---------------------------');
