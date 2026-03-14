const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    // HARDCODED V4 REGISTRY
    const LOGIC_REGISTRY_ADDRESS = "0x66ce441416E2F8c61E8442c4497Ca3FD6bbD2302";
    const cid = "QmW1U211F6ArNyjLoEt7jsDNJ22CrYwuzkQDephk6FHxWy";
    const developer = process.env.DEVELOPER_ADDRESS;

    console.log("Registry:", LOGIC_REGISTRY_ADDRESS);
    console.log("Developer:", developer);

    const abi = ["function registerLogic(string calldata ipfsCid, address developer, bool bettingEnabled, uint8 maxStreets) external returns (bytes32)"];
    const contract = new ethers.Contract(LOGIC_REGISTRY_ADDRESS, abi, wallet);

    try {
        console.log("Sending transaction...");
        const tx = await contract.registerLogic(cid, developer, true, 1);
        console.log("Tx Hash:", tx.hash);
        await tx.wait();
        console.log("Success! Logic is registered.");
        
        // Calculate the Logic ID
        const cidBytes = ethers.toUtf8Bytes(cid);
        const logicId = ethers.keccak256(cidBytes);
        console.log("V4 LOGIC ID:", logicId);
    } catch (e) {
        if (e.message.includes("Logic already registered")) {
           console.log("ALREADY REGISTERED!");
           const cidBytes = ethers.toUtf8Bytes(cid);
           const logicId = ethers.keccak256(cidBytes);
           console.log("V4 LOGIC ID:", logicId);
        } else {
           console.error("Failed:", e.reason || e.message);
        }
    }
}
main();
