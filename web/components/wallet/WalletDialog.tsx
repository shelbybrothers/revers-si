'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';
import { closePicker, connect } from '@/lib/wallet/store';
import { WalletIcon } from './ConnectWallet';
import { copyText, useWallet } from './useWallet';

function isMobileDevice() {
  try {
    return window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Phone browsers have no injected wallet: reopen this page inside a wallet app's own browser. */
function OpenInWallet() {
  const [copied, setCopied] = useState(false);
  // Page URL only: never a query string or anything wallet-related.
  const here = `${window.location.origin}${window.location.pathname}`;
  const hostPath = `${window.location.host}${window.location.pathname}`;
  // Formats from each wallet's developer docs (MetaMask, Coinbase Wallet, Trust Wallet).
  const links = [
    { name: 'MetaMask', href: `https://link.metamask.io/dapp/${hostPath}` },
    { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(here)}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(here)}` },
  ];
  return (
    <div className="wnone">
      <h3>Open revers.si in your wallet’s browser</h3>
      <p>Phone browsers can’t talk to wallet apps directly. Open this page inside your wallet app instead:</p>
      <div className="wlinks">
        {links.map((l) => (
          <a key={l.name} className="btn btn-secondary" href={l.href} rel="noopener noreferrer">
            {l.name}
          </a>
        ))}
      </div>
      <p className="small muted">If the app isn’t installed, the link opens the wallet’s download page.</p>
      <h3>Robinhood Wallet</h3>
      <p>
        Open Robinhood Wallet’s in-app browser (where the app offers one) and enter{' '}
        <span className="mono">{hostPath.replace(/\/$/, '')}</span>.
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => void copyText(here).then(setCopied)}>
        {copied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  );
}

function NoDesktopWallet() {
  return (
    <div className="wnone">
      <h3>No browser wallet found</h3>
      <p>
        Install an EVM browser-extension wallet (MetaMask, Coinbase Wallet or Trust Wallet, for example) and reload this page.
        revers.si can then add Robinhood Chain to it for you.
      </p>
      <p>Robinhood Wallet is mobile-only: on your phone, open revers.si in its in-app browser, where the app offers one.</p>
    </div>
  );
}

function Picker() {
  const s = useWallet();
  const dialog = useRef<HTMLDivElement>(null);
  const [mobile] = useState(isMobileDevice);

  useEffect(() => {
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Counted lock shared with the mobile menu: either can close first without unlocking the other.
    lockScroll();
    const raf = requestAnimationFrame(() => {
      const first = dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.current;
      first?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase: keep the mobile menu's own Escape handler from also closing the menu.
        e.stopPropagation();
        closePicker();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = Array.from(
        dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      unlockScroll();
      // Connect and network changes often replace the control that opened the picker. Restore focus a frame later
      // (once the replacement exists) to the opener if it is still visible, else to the visible wallet control.
      requestAnimationFrame(() => {
        const a = document.activeElement;
        if (a && a !== document.body && a.isConnected) return;
        const visible = (el: HTMLElement | null | undefined) => !!el && el.isConnected && el.getClientRects().length > 0;
        if (visible(prevFocus)) {
          prevFocus?.focus();
          return;
        }
        const next = Array.from(
          document.querySelectorAll<HTMLElement>('.wallet-btn, .wallet-cta, .mwallet .wa-switch, .mwallet .wa-item, .mwallet-cta'),
        ).find(visible);
        next?.focus();
      });
    };
  }, []);

  const busy = s.status === 'connecting' || s.pending;
  return (
    <div className="wdlg-layer">
      <div className="wdlg-backdrop" aria-hidden="true" onClick={closePicker} />
      <div ref={dialog} className="wdlg" role="dialog" aria-modal="true" aria-labelledby="wdlg-title" tabIndex={-1}>
        <div className="wdlg-h">
          <h2 id="wdlg-title">Connect wallet</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closePicker}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
        <p className="wdlg-lede">
          Read-only. revers.si asks your wallet for your address and network, then reads Robinhood Chain through it. No
          signatures, no transactions, no approvals.
        </p>

        {s.options.length > 0 ? (
          <ul className="wlist" aria-label="Detected wallets">
            {s.options.map((o, i) => {
              const connecting = s.connectingKey === o.key;
              const current = s.status === 'connected' && s.wallet?.key === o.key;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    className="wopt"
                    data-autofocus={i === 0 ? '' : undefined}
                    onClick={() => void connect(o)}
                    disabled={busy && !connecting}
                    aria-busy={connecting || undefined}
                  >
                    <WalletIcon option={o} size={32} />
                    <span className="wopt-t">
                      <b>{o.name}</b>
                      <span className="mono">{o.source === 'injected' ? `window.ethereum${o.hint ? ` · ${o.hint}` : ''}` : o.rdns}</span>
                    </span>
                    <span className="wopt-s">{connecting ? 'Check your wallet…' : current ? 'Connected' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : !s.discovered ? (
          <p className="wdlg-wait">Looking for browser wallets…</p>
        ) : mobile ? (
          <OpenInWallet />
        ) : (
          <NoDesktopWallet />
        )}

        {s.tampered && (
          <p className="wdlg-msg error">Two wallets announced the same id; the second one was ignored.</p>
        )}
        {/* Always mounted so it works as a live region; collapses (CSS :empty) when there is no notice. */}
        <p className={`wdlg-msg${s.notice?.tone === 'error' ? ' error' : ''}`} role="status">
          {s.notice?.text}
        </p>
        <p className="wdlg-foot">
          revers.si is an independent project, not affiliated with Robinhood. Nothing is stored on a server; this browser
          remembers only which wallet you picked.
        </p>
      </div>
    </div>
  );
}

/** Wallet picker, portalled to <body> (the nav's backdrop-filter would otherwise trap a fixed overlay). */
export function WalletDialog() {
  const s = useWallet();
  if (!s.pickerOpen) return null;
  return createPortal(<Picker />, document.body);
}
