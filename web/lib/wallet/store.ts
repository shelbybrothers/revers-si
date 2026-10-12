/**
 * Client-side wallet state shared by the nav and /wallet (one instance per page load).
 * EIP-6963 discovery with a window.ethereum fallback, raw EIP-1193 calls, no dependencies.
 * Nothing leaves the browser except the wallet requests themselves; the only thing persisted is
 * the last wallet's rdns (and whether the user chose Disconnect) in localStorage.
 */
import {
  cleanLabel,
  errorCode,
  errorMessage,
  isUnrecognizedChain,
  normalizeChainId,
  REQUEST_PENDING,
  safeIcon,
  safeRequest,
  toAccounts,
  USER_REJECTED,
  type Eip1193Provider,
  type Eip6963Info,
} from './eip1193';
import { ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_HEX, toChecksumAddress } from './evm';

export type WalletOption = {
  key: string;
  name: string;
  rdns: string;
  icon: string | null;
  provider: Eip1193Provider;
  source: 'eip6963' | 'injected';
  hint?: string;
};

export type Notice = { tone: 'info' | 'error'; text: string } | null;

export type WalletState = {
  discovered: boolean;
  options: WalletOption[];
  tampered: boolean;
  status: 'idle' | 'connecting' | 'connected';
  connectingKey: string | null;
  wallet: WalletOption | null;
  account: string | null;
  chainId: string | null;
  switching: boolean;
  notice: Notice;
  pending: boolean;
  pickerOpen: boolean;
  manualNetwork: boolean;
};

const INITIAL: WalletState = {
  discovered: false,
  options: [],
  tampered: false,
  status: 'idle',
  connectingKey: null,
  wallet: null,
  account: null,
  chainId: null,
  switching: false,
  notice: null,
  pending: false,
  pickerOpen: false,
  manualNetwork: false,
};

let state: WalletState = INITIAL;
const subscribers = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export const getSnapshot = () => state;
export const getServerSnapshot = () => INITIAL;

export const onRobinhoodChain = (s: Pick<WalletState, 'chainId'>) => s.chainId === ROBINHOOD_CHAIN_HEX;

// ---------- persistence (per browser, best effort) ----------

const MEMORY_KEY = 'revers.wallet.v1';
type Memory = { rdns: string | null; off: boolean };

function readMemory(): Memory {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    const m = raw ? (JSON.parse(raw) as Partial<Memory>) : null;
    return { rdns: typeof m?.rdns === 'string' ? m.rdns : null, off: m?.off === true };
  } catch {
    return { rdns: null, off: false };
  }
}

function writeMemory(m: Memory) {
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: nothing to remember */
  }
}

// ---------- discovery ----------

let initialized = false;
let restoreTried = false;
let session = 0;
let pendingTimer: number | undefined;

const INJECTED_RDNS = 'window.ethereum';

function onAnnounce(e: Event) {
  const detail = (e as CustomEvent<{ info?: Partial<Eip6963Info>; provider?: Eip1193Provider }>).detail;
  const info = detail?.info;
  const provider = detail?.provider;
  if (!info || !provider || typeof provider.request !== 'function') return;
  if (typeof info.uuid !== 'string' || !info.uuid || typeof info.rdns !== 'string') return;
  const existing = state.options.find((o) => o.key === info.uuid);
  if (existing) {
    // Same uuid from a different provider object: EIP-6963 says to treat that as tampering.
    if (existing.provider !== provider) set({ tampered: true });
    return;
  }
  const option: WalletOption = {
    key: info.uuid,
    name: cleanLabel(info.name) || 'Wallet',
    rdns: cleanLabel(info.rdns, 80),
    icon: safeIcon(info.icon),
    provider,
    source: 'eip6963',
  };
  // The window.ethereum fallback is only for wallets that do not announce; drop it once one does.
  const others = state.options.filter((o) => o.source !== 'injected' || o === state.wallet);
  set({ options: [...others, option] });
  void tryRestore();
}

function addInjectedFallback() {
  if (state.options.length) return;
  const eth = (window as unknown as { ethereum?: Eip1193Provider & Record<string, unknown> }).ethereum;
  if (!eth || typeof eth.request !== 'function') return;
  const hint = eth.isRobinhoodMobileWallet
    ? 'reports Robinhood Wallet'
    : eth.isCoinbaseWallet
      ? 'reports Coinbase Wallet'
      : eth.isTrust || eth.isTrustWallet
        ? 'reports Trust Wallet'
        : eth.isMetaMask
          ? 'reports MetaMask'
          : undefined;
  set({
    options: [{ key: 'injected', name: 'Browser wallet', rdns: INJECTED_RDNS, icon: null, provider: eth, source: 'injected', hint }],
  });
}

/** Starts EIP-6963 discovery once per page load. Safe to call from every component that uses the store. */
export function initWallet() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // EIP-6963: listen first, then request; the listener stays for the page's lifetime (late wallets re-announce).
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  window.setTimeout(() => {
    addInjectedFallback();
    set({ discovered: true });
    void tryRestore();
  }, 450);
}

/** Silent reconnect (eth_accounts never prompts) to the last wallet, unless the user chose Disconnect. */
async function tryRestore() {
  if (restoreTried || state.status !== 'idle') return;
  const mem = readMemory();
  if (!mem.rdns || mem.off) {
    restoreTried = true;
    return;
  }
  const option = state.options.find((o) => o.rdns === mem.rdns);
  if (!option) return;
  restoreTried = true;
  const my = ++session;
  try {
    const accounts = toAccounts(await safeRequest(option.provider, 'eth_accounts'));
    if (my !== session || state.status !== 'idle' || !accounts.length) return;
    await attach(option, accounts[0], my);
  } catch {
    /* stay disconnected */
  }
}

// ---------- provider events ----------

let detachListeners: (() => void) | null = null;

function listen(option: WalletOption) {
  detachListeners?.();
  const p = option.provider;
  const onAccounts = (...args: unknown[]) => {
    if (state.wallet !== option) return;
    const accounts = toAccounts(args[0]);
    if (!accounts.length) {
      localDisconnect(false, { tone: 'info', text: 'Your wallet disconnected this site.' });
      return;
    }
    set({ account: toChecksumAddress(accounts[0]), pending: false });
  };
  const onChain = (...args: unknown[]) => {
    if (state.wallet !== option) return;
    set({ chainId: normalizeChainId(args[0]), manualNetwork: false });
  };
  try {
    p.on?.('accountsChanged', onAccounts);
    p.on?.('chainChanged', onChain);
  } catch {
    /* provider without events: state refreshes on the next action */
  }
  detachListeners = () => {
    try {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
    } catch {
      /* ignore */
    }
    detachListeners = null;
  };
}

async function attach(option: WalletOption, account: string, my: number) {
  let chainId: string | null = null;
  try {
    chainId = normalizeChainId(await safeRequest(option.provider, 'eth_chainId'));
  } catch {
    /* unknown network: shown as "Wrong network" until chainChanged */
  }
  if (my !== session) return;
  listen(option);
  set({
    status: 'connected',
    wallet: option,
    account: toChecksumAddress(account),
    chainId,
    connectingKey: null,
    notice: null,
    manualNetwork: false,
  });
}

// ---------- actions ----------

function setPending() {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => set({ pending: false }), 15_000);
  set({ pending: true, notice: { tone: 'info', text: 'Check your wallet: a request is already open there.' } });
}

function describe(e: unknown, what: string): Notice {
  const code = errorCode(e);
  if (code === USER_REJECTED) return { tone: 'info', text: 'Request cancelled in your wallet.' };
  return { tone: 'error', text: `${what}: ${errorMessage(e)}` };
}

export function openPicker() {
  initWallet();
  set({ pickerOpen: true, notice: state.status === 'connected' ? state.notice : null });
}

export function closePicker() {
  set({ pickerOpen: false });
}

export async function connect(option: WalletOption) {
  if (state.pending || state.status === 'connecting') return;
  const my = ++session;
  set({ status: 'connecting', connectingKey: option.key, notice: null });
  try {
    const accounts = toAccounts(await safeRequest(option.provider, 'eth_requestAccounts'));
    if (my !== session) return;
    if (!accounts.length) throw new Error('The wallet did not share an account.');
    detachListeners?.();
    await attach(option, accounts[0], my);
    if (my !== session) return;
    writeMemory({ rdns: option.rdns, off: false });
    set({ pickerOpen: false });
  } catch (e) {
    if (my !== session) return;
    set({ status: state.wallet ? 'connected' : 'idle', connectingKey: null });
    if (errorCode(e) === REQUEST_PENDING) setPending();
    else set({ notice: describe(e, 'Could not connect') });
  }
}

export async function switchToRobinhoodChain() {
  const option = state.wallet;
  if (!option || state.switching || state.pending) return;
  set({ switching: true, notice: null, manualNetwork: false });
  try {
    try {
      await safeRequest(option.provider, 'wallet_switchEthereumChain', [{ chainId: ROBINHOOD_CHAIN_HEX }]);
    } catch (e) {
      if (!isUnrecognizedChain(e)) throw e;
      // Unknown to the wallet: add it with the official parameters (most wallets then switch to it).
      await safeRequest(option.provider, 'wallet_addEthereumChain', [JSON.parse(JSON.stringify(ROBINHOOD_CHAIN))]);
    }
    const chainId = normalizeChainId(await safeRequest(option.provider, 'eth_chainId'));
    if (state.wallet !== option) return;
    set({ chainId, switching: false });
    if (chainId !== ROBINHOOD_CHAIN_HEX) {
      set({ manualNetwork: true, notice: { tone: 'info', text: 'Your wallet is still on another network.' } });
    }
  } catch (e) {
    if (state.wallet !== option) return;
    set({ switching: false });
    const code = errorCode(e);
    if (code === REQUEST_PENDING) setPending();
    else if (code === USER_REJECTED) set({ notice: describe(e, '') });
    else set({ notice: { tone: 'error', text: 'Your wallet could not switch networks automatically.' }, manualNetwork: true });
  }
}

function localDisconnect(remember: boolean, notice: Notice) {
  detachListeners?.();
  session++;
  if (remember) writeMemory({ rdns: state.wallet?.rdns ?? readMemory().rdns, off: true });
  set({ status: 'idle', wallet: null, account: null, chainId: null, switching: false, connectingKey: null, manualNetwork: false, notice });
}

/** Forgets the connection locally; also asks the wallet to revoke access where supported (errors ignored). */
export function disconnect() {
  const option = state.wallet;
  localDisconnect(true, null);
  if (!option) return;
  try {
    safeRequest(option.provider, 'wallet_revokePermissions', [{ eth_accounts: {} }]).catch(() => undefined);
  } catch {
    /* not supported */
  }
}
