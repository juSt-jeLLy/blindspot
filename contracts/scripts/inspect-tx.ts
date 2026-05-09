import { ethers } from 'hardhat';

async function main() {
  const txHash = process.env.TX_HASH || '0x6a890e33c2ca49e02aeb4a4ce45cdd6d871e265484083c019fedde0c157816bd';
  const provider = ethers.provider;
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('receipt not found');
  console.log('to', receipt.to);
  console.log('block', receipt.blockNumber);
  console.log('status', receipt.status);
  const iface = new ethers.Interface([
    'event SellOrderSubmitted(uint256 indexed orderId, address indexed seller)',
    'event BuyOrderSubmitted(uint256 indexed orderId, address indexed buyer)',
  ]);
  for (const log of receipt.logs) {
    try {
      const p = iface.parseLog(log);
      console.log('event', p?.name, p?.args?.map((x:any)=>x.toString()));
    } catch {}
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
