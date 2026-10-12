'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { lockScroll, unlockScroll } from '@/lib/scrollLock';
import { SITE, TOKEN } from '@/lib/site';
import { shortAddress } from '@/lib/wallet/evm';
import { onRobinhoodChain } from '@/lib/wallet/store';
import { ConnectWallet, MobileWallet, NetworkBadge } from './wallet/ConnectWallet';
import { WalletDialog } from './wallet/WalletDialog';
import { useWallet } from './wallet/useWallet';
import { XIcon } from './XIcon';

const LINKS = [
  { href: '/lab', label: 'Lab' },
  { href: '/#scenarios', label: 'Scenarios' },
  { href: '/#how', label: 'How it works' },
  { href: '/docs', label: 'Docs' },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const w = useWallet();
  const connected = w.status === 'connected' && !!w.account;
  const short = connected ? shortAddress(w.account ?? '') : '';
  const walletLabel = connected ? `, wallet ${short} on ${onRobinhoodChain(w) ? 'Robinhood Chain' : 'wrong network'}` : '';

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    // Counted lock shared with the wallet picker: either can close first without unlocking the other.
    lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      unlockScroll();
    };
  }, [open]);

  // The mobile menu is a sibling of <header>: the header's backdrop-filter would otherwise
  // become the containing block for the fixed-position menu and collapse it.
  return (
    <>
    <header className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="wordmark" aria-label="revers.si home">
          <img src="/brand/revers-64.png" alt="" width={28} height={28} />
          <span>
            revers<span className="dot">.</span>si
          </span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="link" aria-current={pathname === l.href ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
          <a className="icon-btn" href={SITE.x} target="_blank" rel="noopener noreferrer" aria-label="revers.si on X (@reversintel)">
            <XIcon />
          </a>
          <ConnectWallet />
          <a className="btn btn-accent nav-cta" href={TOKEN.buyUrl} target="_blank" rel="noopener noreferrer">
            Buy ${TOKEN.symbol}
          </a>
        </nav>
        <button
          type="button"
          className={`icon-btn menu-btn${connected ? ' menu-btn-wallet' : ''}`}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={`${open ? 'Close menu' : 'Open menu'}${walletLabel}`}
          onClick={() => setOpen((o) => !o)}
        >
          {connected && (
            <span className="mstatus" aria-hidden="true">
              <NetworkBadge chainId={w.chainId} compact />
              <span className="mono">{short}</span>
            </span>
          )}
          <span className="bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>
    </header>
      {open && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Mobile">
          {LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} className="mlink" onClick={() => setOpen(false)}>
              {l.label}
              <span className="mono">0{i + 1}</span>
            </Link>
          ))}
          <a className="mlink" href={SITE.x} target="_blank" rel="noopener noreferrer">
            X / {SITE.xHandle}
            <XIcon size={18} />
          </a>
          <MobileWallet onNavigate={() => setOpen(false)} />
          <a className="btn btn-accent" href={TOKEN.buyUrl} target="_blank" rel="noopener noreferrer">
            Buy ${TOKEN.symbol} on GMGN
          </a>
          <a className="btn btn-secondary mfollow" href={SITE.x} target="_blank" rel="noopener noreferrer">
            Follow on X
          </a>
        </nav>
      )}
      <WalletDialog />
    </>
  );
}
