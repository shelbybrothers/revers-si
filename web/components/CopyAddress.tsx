'use client';

import { useState } from 'react';

/** Shows a full contract address with a copy button, so people can compare it before they buy. */
export function CopyAddress({ address, label = 'Copy contract address' }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ca">
      <code className="ca-addr">{address}</code>
      <button type="button" className="btn btn-secondary ca-btn" onClick={copy} aria-label={label}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Contract address copied' : ''}</span>
    </div>
  );
}
