// DEMO EIP-1193 provider for the wallet-check recording (injected with addInitScript; never shipped to the site).
// It announces itself over EIP-6963 as "Demo wallet (simulated)" and:
//   - reports chain 0x1237 (Robinhood Chain) and ONE public address (window.__DEMO_ADDRESS, a public contract);
//   - forwards the three read methods revers.si uses (eth_call, eth_getCode, eth_getBalance) to the public Robinhood
//     Chain RPC, so every verdict on screen comes from real chain reads;
//   - refuses everything else (signatures, transactions, approvals) with EIP-1193 error 4200. The site never asks
//     for those anyway (lib/wallet/eip1193.ts allow-list); window.__DEMO_LOG records every method it was asked for.
(() => {
  const ADDRESS = window.__DEMO_ADDRESS;
  const RPC = window.__DEMO_RPC || 'https://robinhood-rpc.publicnode.com';
  const READS = new Set(['eth_call', 'eth_getCode', 'eth_getBalance']);
  const log = (window.__DEMO_LOG = []);
  let nextId = 1;
  const listeners = {};
  const fail = (code, message) => Object.assign(new Error(message), { code });
  const provider = {
    isDemoWallet: true,
    async request({ method, params } = {}) {
      log.push(method);
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_accounts') return [ADDRESS];
      if (method === 'eth_requestAccounts') {
        await new Promise((r) => setTimeout(r, 700)); // a wallet takes a moment to answer
        return [ADDRESS];
      }
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_revokePermissions') return null;
      if (READS.has(method)) {
        const res = await fetch(RPC, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: params ?? [] }),
        });
        const j = await res.json();
        if (j.error) throw fail(j.error.code ?? -32603, j.error.message ?? 'RPC error');
        return j.result;
      }
      throw fail(4200, `Demo wallet: ${method} is not supported (read-only demo, no signing)`);
    },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return provider; },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
  };
  const icon = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
    + '<rect width="64" height="64" rx="14" fill="#0f2a1e"/>'
    + '<rect x="12" y="20" width="40" height="28" rx="6" fill="none" stroke="#bfdfb4" stroke-width="4"/>'
    + '<circle cx="42" cy="34" r="4" fill="#bfdfb4"/></svg>');
  const info = Object.freeze({ uuid: '6f1c2a9e-3b7d-4e58-9c1a-5d2e8f7b4a10', name: 'Demo wallet (simulated)', icon, rdns: 'si.revers.demo' });
  const detail = Object.freeze({ info, provider });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();
