'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EXPLORER, ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_ID, shortAddress } from '@/lib/wallet/evm';
import {
  disconnect,
  onRobinhoodChain,
  openPicker,
  switchToRobinhoodChain,
  type WalletOption,
} from '@/lib/wallet/store';
import { copyText, useWallet } from './useWallet';

/** Wallet-provided icon, rendered only through <img src> (EIP-6963: SVG icons may contain script). */
export function WalletIcon({ option, size = 24 }: { option: Pick<WalletOption, 'icon'> | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (option?.icon && !broken) {
    return (
      <img
        className="wicon"
        src={option.icon}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="wicon wicon-generic" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" />
        <path d="M10.5 8.5h4" />
        <path d="M3.5 3.5l7-2v2" />
      </svg>
    </span>
  );
}

export function NetworkBadge({ chainId, compact = false }: { chainId: string | null; compact?: boolean }) {
  const ok = onRobinhoodChain({ chainId });
  const title = ok ? 'Robinhood Chain (4663)' : chainId ? `Connected to chain ${parseInt(chainId, 16)}` : 'Unknown network';
  return (
    <span className={`net ${ok ? 'net-ok' : 'net-bad'}${compact ? ' net-compact' : ''}`} title={title}>
      <i aria-hidden="true" />
      <span className="net-label">{ok ? 'Robinhood Chain' : 'Wrong network'}</span>
    </span>
  );
}

/** Manual network details, shown when a wallet cannot switch or add the chain itself. */
export function ManualNetwork() {
  return (
    <div className="manual-net">
      <p>Add the network in your wallet’s settings, then switch to it:</p>
      <dl>
        <dt>Network name</dt>
        <dd>{ROBINHOOD_CHAIN.chainName}</dd>
        <dt>RPC URL</dt>
        <dd className="mono">{ROBINHOOD_CHAIN.rpcUrls[0]}</dd>
        <dt>Chain ID</dt>
        <dd className="mono">{ROBINHOOD_CHAIN_ID}</dd>
        <dt>Currency</dt>
        <dd className="mono">{ROBINHOOD_CHAIN.nativeCurrency.symbol}</dd>
        <dt>Explorer</dt>
        <dd className="mono">{EXPLORER}</dd>
      </dl>
    </div>
  );
}

/** Connected-wallet panel: network switch, Wallet check, copy, disconnect. Used in the desktop menu and the mobile menu. */
export function WalletActions({ onNavigate }: { onNavigate?: () => void }) {
  const s = useWallet();
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ok = onRobinhoodChain(s);
  const prevOk = useRef(ok);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  // After a successful switch the Switch button unmounts and focus would drop to <body>: move it to the list.
  useEffect(() => {
    const was = prevOk.current;
    prevOk.current = ok;
    if (!ok || was) return;
    const a = document.activeElement;
    if (!a || a === document.body) root.current?.querySelector<HTMLElement>('.wa-item')?.focus();
  }, [ok]);
  if (!s.account) return null;
  return (
    <div className="wallet-actions" ref={root}>
      <div className="wa-head">
        <WalletIcon option={s.wallet} size={28} />
        <div className="wa-id">
          <div className="wa-name">{s.wallet?.name ?? 'Wallet'}</div>
          <div className="mono wa-addr">{s.account}</div>
        </div>
      </div>
      <NetworkBadge chainId={s.chainId} />
      {!ok && (
        <button
          type="button"
          className={`btn btn-accent wa-switch${s.switching ? ' btn-busy' : ''}`}
          onClick={() => void switchToRobinhoodChain()}
          disabled={s.switching || s.pending}
        >
          {s.switching ? 'Confirm in your wallet…' : 'Switch to Robinhood Chain'}
        </button>
      )}
      {s.manualNetwork && !ok && <ManualNetwork />}
      <div className="wa-list">
        <Link href="/wallet" className="wa-item" onClick={onNavigate} aria-current={pathname === '/wallet' ? 'page' : undefined}>
          Wallet check <span aria-hidden="true">→</span>
        </Link>
        <button type="button" className="wa-item" onClick={() => void copyText(s.account ?? '').then(setCopied)}>
          {copied ? 'Copied' : 'Copy address'}
          <span className="mono small" aria-hidden="true">{shortAddress(s.account)}</span>
        </button>
        <button type="button" className="wa-item" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      <p className="wa-note" role="status">
        {s.notice ? s.notice.text : 'Read-only: revers.si never asks your wallet to sign anything.'}
      </p>
    </div>
  );
}

/** Desktop nav control: "Connect wallet", or the connected address + network badge with a small menu. */
export function ConnectWallet() {
  const s = useWallet();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  const pathname = usePathname();
  const connected = s.status === 'connected' && !!s.account;
  const ok = onRobinhoodChain(s);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    menuWasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (connected) return;
    // Disconnect from the open menu replaces the whole control: keep keyboard focus on its replacement.
    if (menuWasOpen.current) cta.current?.focus();
    setOpen(false);
  }, [connected]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close when keyboard focus leaves the control (Tab past Disconnect). Checked a frame later so a wallet popup
  // taking window focus, or a control re-rendering under the pointer, does not close the menu.
  const onBlur = () => {
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return;
      const a = document.activeElement;
      if (a && a !== document.body && !wrap.current?.contains(a)) setOpen(false);
    });
  };

  if (!connected) {
    return (
      <button
        ref={cta}
        type="button"
        className={`btn btn-secondary wallet-cta${s.status === 'connecting' ? ' btn-busy' : ''}`}
        aria-haspopup="dialog"
        onClick={openPicker}
        disabled={s.status === 'connecting'}
      >
        {s.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }
  const short = shortAddress(s.account ?? '');
  return (
    <div className="wallet-wrap" ref={wrap} onBlur={onBlur}>
      <button
        ref={btn}
        type="button"
        className={`wallet-btn${ok ? '' : ' wallet-btn-bad'}`}
        aria-label={`Wallet ${short}, ${ok ? 'Robinhood Chain' : 'wrong network'}`}
        aria-expanded={open}
        aria-controls={open ? 'wallet-menu' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <NetworkBadge chainId={s.chainId} compact />
        <span className="mono">{short}</span>
        <svg className="chev" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        // tabIndex -1: a click on the menu's text keeps focus inside the control instead of moving it to <body>.
        <div id="wallet-menu" className="wallet-menu panel" tabIndex={-1}>
          <WalletActions onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Mobile-menu variant: a full-width connect button, or the connected panel inline. */
export function MobileWallet({ onNavigate }: { onNavigate?: () => void }) {
  const s = useWallet();
  const cta = useRef<HTMLButtonElement>(null);
  const connected = s.status === 'connected' && !!s.account;
  const wasConnected = useRef(connected);
  useEffect(() => {
    const was = wasConnected.current;
    wasConnected.current = connected;
    if (connected || !was) return;
    // Disconnect replaced the panel the focused button was in: keep focus in the menu.
    const a = document.activeElement;
    if (!a || a === document.body) cta.current?.focus();
  }, [connected]);
  if (!connected) {
    return (
      <button
        ref={cta}
        type="button"
        className={`btn btn-secondary mwallet-cta${s.status === 'connecting' ? ' btn-busy' : ''}`}
        aria-haspopup="dialog"
        onClick={openPicker}
        disabled={s.status === 'connecting'}
      >
        {s.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }
  return (
    <div className="mwallet panel">
      <WalletActions onNavigate={onNavigate} />
    </div>
  );
}
