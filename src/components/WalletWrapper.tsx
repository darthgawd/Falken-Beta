'use client';

import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownDisconnect,
} from '@coinbase/onchainkit/wallet';
import {
  Address,
  Avatar,
  Name,
  Identity,
  EthBalance,
} from '@coinbase/onchainkit/identity';

export function WalletWrapper() {
  return (
    <Wallet>
      <ConnectWallet className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 transition-colors flex items-center gap-2">
        <Avatar className="h-6 w-6" />
        <Name className="text-white" />
      </ConnectWallet>
      <WalletDropdown className="bg-zinc-900 border border-zinc-800 rounded-xl mt-2 p-2">
        <Identity className="px-4 pt-3 pb-2 flex flex-col gap-1" hasCopyAddressOnClick>
          <Avatar />
          <Name />
          <Address className="text-zinc-500" />
          <EthBalance className="text-zinc-400" />
        </Identity>
        <WalletDropdownDisconnect className="hover:bg-red-500/10 text-red-500 rounded-lg transition-colors mt-2 w-full text-left px-4 py-2" />
      </WalletDropdown>
    </Wallet>
  );
}
