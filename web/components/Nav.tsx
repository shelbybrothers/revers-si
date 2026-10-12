'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SITE } from '@/lib/site';
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

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prev;
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
          <a className="btn btn-accent nav-cta" href={SITE.x} target="_blank" rel="noopener noreferrer">
            Follow on X
          </a>
        </nav>
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
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
          <a className="btn btn-accent" href={SITE.x} target="_blank" rel="noopener noreferrer">
            Follow on X
          </a>
        </nav>
      )}
    </>
  );
}
