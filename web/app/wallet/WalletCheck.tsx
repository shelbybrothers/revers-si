'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ManualNetwork, NetworkBadge, WalletIcon } from '@/components/wallet/ConnectWallet';
import { copyText, useWallet } from '@/components/wallet/useWallet';
import { EXPLORER, formatUnits, hasValidChecksum, isAddress, toChecksumAddress } from '@/lib/wallet/evm';
import { errorMessage } from '@/lib/wallet/eip1193';
import { onRobinhoodChain, openPicker, switchToRobinhoodChain } from '@/lib/wallet/store';
import {
  getEthBalance,
  scanHoldings,
  verifyTokens,
  WrongNetworkError,
  type CandidateList,
  type CheckStatus,
  type ScanProgress,
  type TokenReport,
  type Verdict,
} from '@/lib/wallet/stockTokens';

export type ListSummary = { tokens: number; lookalikes: number; generatedAt: string; block: number; source: string };

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  genuine: { label: 'Genuine', cls: 'chip-pass' },
  'not-stock-token': { label: 'Not a Robinhood Stock Token', cls: 'chip-fail' },
  unknown: { label: 'Unknown', cls: 'chip-deferred' },
};
const CHECK_CLS: Record<CheckStatus, string> = {
  pass: 'chip-pass',
  fail: 'chip-fail',
  unknown: 'chip-deferred',
  'n/a': 'chip-na',
  info: 'chip-na',
};

let listCache: Promise<CandidateList> | null = null;
function loadList(): Promise<CandidateList> {
  if (!listCache) {
    listCache = fetch('/data/stock-tokens.json', { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(`candidate list: HTTP ${r.status}`);
      return r.json() as Promise<CandidateList>;
    });
    listCache.catch(() => {
      listCache = null; // retry on the next scan
    });
  }
  return listCache;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

function TokenCard({ report, holding }: { report: TokenReport; holding: boolean }) {
  const v = VERDICT[report.verdict];
  const dec = report.decimals;
  const uiMatches = report.shareEquivalent !== null && report.balanceUI !== null && report.shareEquivalent === report.balanceUI;
  return (
    <article className="tcard panel">
      <div className="tcard-h">
        <div className="tcard-id">
          <div className="tcard-sym">
            {report.symbol || 'Unnamed token'}
            {report.name && <span className="muted"> · {report.name}</span>}
          </div>
          <div className="mono tcard-addr">{toChecksumAddress(report.address)}</div>
        </div>
        <span className={`chip ${v.cls}`}>{v.label}</span>
      </div>
      <p className="tcard-reason">{report.reason}</p>

      {holding && report.balance !== null && (
        <dl className="tcard-bal">
          <div>
            <dt>Raw balance</dt>
            <dd className="mono">{report.balance.toString()}</dd>
            <dd className="small muted">{dec !== null ? `${formatUnits(report.balance, dec)} tokens (${dec} decimals)` : 'decimals() unreadable'}</dd>
          </div>
          {report.uiMultiplier !== null && (
            <div>
              <dt>
                {report.verdict === 'genuine'
                  ? 'uiMultiplier'
                  : `uiMultiplier (reported by this contract; ${report.verdict === 'unknown' ? 'unverified' : 'not a Stock Token'})`}
              </dt>
              <dd className="mono">{report.uiMultiplier.toString()}</dd>
              <dd className="small muted">×{formatUnits(report.uiMultiplier, 18, 9)}</dd>
            </div>
          )}
          {report.verdict === 'genuine' && report.shareEquivalent !== null && dec !== null && (
            <div>
              <dt>Share-equivalent balance</dt>
              <dd className="mono">{formatUnits(report.shareEquivalent, dec)}</dd>
              <dd className="small muted">
                balance × uiMultiplier ÷ 10¹⁸.{' '}
                {report.balanceUI === null ? 'balanceOfUI() unreadable.' : uiMatches ? 'Matches balanceOfUI() on chain.' : `balanceOfUI() on chain: ${formatUnits(report.balanceUI, dec)}.`}
              </dd>
            </div>
          )}
        </dl>
      )}

      <details className="tcard-ev" open={!holding}>
        <summary>Evidence · {report.checks.length} checks</summary>
        <ul className="checks">
          {report.checks.map((c) => (
            <li key={c.id}>
              <span className={`chip ${CHECK_CLS[c.status]}`}>{c.status}</span>
              <div>
                <div className="lbl mono">{c.label}</div>
                <div className="dt">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <a className="tcard-link" href={`${EXPLORER}/token/${toChecksumAddress(report.address)}`} target="_blank" rel="noopener noreferrer">
        Token on Blockscout ↗
      </a>
    </article>
  );
}

function YourWallet() {
  const s = useWallet();
  const [eth, setEth] = useState<{ v: bigint | null; err: string | null; loading: boolean }>({ v: null, err: null, loading: false });
  const [copied, setCopied] = useState(false);
  const ok = s.status === 'connected' && onRobinhoodChain(s);
  const provider = s.wallet?.provider;
  const copyBtn = useRef<HTMLButtonElement>(null);
  const prevOk = useRef(ok);

  // After a successful switch the Switch button unmounts and focus would drop to <body>.
  useEffect(() => {
    const was = prevOk.current;
    prevOk.current = ok;
    if (!ok || was) return;
    const a = document.activeElement;
    if (!a || a === document.body) copyBtn.current?.focus();
  }, [ok]);

  useEffect(() => {
    if (!ok || !provider || !s.account) return;
    let live = true;
    setEth({ v: null, err: null, loading: true });
    getEthBalance(provider, s.account).then(
      (v) => live && setEth({ v, err: null, loading: false }),
      (e) => live && setEth({ v: null, err: errorMessage(e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [ok, provider, s.account]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (s.status !== 'connected' || !s.account) {
    return (
      <div className="wc-card panel">
        <h2 className="wc-h">Your wallet</h2>
        <p className="muted">{s.status === 'connecting' ? 'Waiting for your wallet…' : 'Not connected.'}</p>
        <button
          type="button"
          className={`btn btn-accent${s.status === 'connecting' ? ' btn-busy' : ''}`}
          onClick={openPicker}
          disabled={s.status === 'connecting'}
        >
          {s.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
        </button>
        {s.notice && !s.pickerOpen && (
          <p className={`small ${s.notice.tone === 'error' ? 'wc-err' : 'muted'}`} role="status">
            {s.notice.text}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="wc-card panel">
      <h2 className="wc-h">Your wallet</h2>
      <div className="wa-head">
        <WalletIcon option={s.wallet} size={28} />
        <div className="wa-id">
          <div className="wa-name">{s.wallet?.name}</div>
          <div className="mono wa-addr">{s.account}</div>
        </div>
      </div>
      <div className="wc-row">
        <NetworkBadge chainId={s.chainId} />
        {ok && (
          <span className="chip">
            ETH {eth.loading ? '…' : eth.v !== null ? formatUnits(eth.v, 18) : 'unreadable'}
          </span>
        )}
        <button ref={copyBtn} type="button" className="btn btn-secondary wc-copy" onClick={() => void copyText(s.account ?? '').then(setCopied)}>
          {copied ? 'Copied' : 'Copy address'}
        </button>
      </div>
      {eth.err && <p className="small muted">eth_getBalance failed: {eth.err}</p>}
      {!ok && (
        <>
          <p>Your wallet is on another network. The checks only run on Robinhood Chain.</p>
          <button
            type="button"
            className={`btn btn-accent${s.switching ? ' btn-busy' : ''}`}
            onClick={() => void switchToRobinhoodChain()}
            disabled={s.switching || s.pending}
          >
            {s.switching ? 'Confirm in your wallet…' : 'Switch to Robinhood Chain'}
          </button>
          {s.manualNetwork && <ManualNetwork />}
        </>
      )}
      {s.notice && (
        <p className={`small ${s.notice.tone === 'error' ? 'wc-err' : 'muted'}`} role="status">
          {s.notice.text}
        </p>
      )}
    </div>
  );
}

type ScanState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: ScanProgress | null }
  | { phase: 'done'; reports: TokenReport[]; unread: number; total: number; at: Date }
  | { phase: 'error'; message: string };

function Holdings({ summary }: { summary: ListSummary }) {
  const s = useWallet();
  const ok = s.status === 'connected' && onRobinhoodChain(s);
  const provider = s.wallet?.provider;
  const account = s.account;
  const [scan, setScan] = useState<ScanState>({ phase: 'idle' });
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!provider || !account) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setScan({ phase: 'running', progress: null });
    try {
      const list = await loadList();
      const res = await scanHoldings(provider, account, list, (p) => !c.signal.aborted && setScan({ phase: 'running', progress: p }), c.signal);
      if (!c.signal.aborted) setScan({ phase: 'done', ...res, at: new Date() });
    } catch (e) {
      if (isAbort(e) || c.signal.aborted) return;
      setScan({ phase: 'error', message: e instanceof WrongNetworkError ? e.message : `Scan failed: ${errorMessage(e)}` });
    }
  }, [provider, account]);

  // One automatic scan per wallet + account while on Robinhood Chain; re-runs when either changes.
  useEffect(() => {
    if (!ok) {
      ctrl.current?.abort();
      setScan({ phase: 'idle' });
      return;
    }
    void run();
    return () => ctrl.current?.abort();
  }, [ok, run]);

  const built = summary.generatedAt.slice(0, 10);
  let body: React.ReactNode;
  if (!ok) {
    body = (
      <p className="muted">
        {s.status === 'connected'
          ? 'Switch your wallet to Robinhood Chain to scan it.'
          : 'Connect a wallet on Robinhood Chain to scan it for Stock Tokens.'}
      </p>
    );
  } else if (scan.phase === 'running' || scan.phase === 'idle') {
    const p = scan.phase === 'running' ? scan.progress : null;
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
    const label = !p
      ? 'Loading the candidate list…'
      : p.phase === 'balances'
        ? `Reading balances · ${p.done} / ${p.total} candidates`
        : `Verifying ${p.total} token${p.total === 1 ? '' : 's'} with a balance on chain…`;
    body = (
      <div className="wc-progress" aria-live="polite">
        <div className="mono small">{label}</div>
        <div className="meter" role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p?.phase === 'verify' ? 100 : pct}>
          <i style={{ width: `${p?.phase === 'verify' ? 100 : pct}%` }} />
        </div>
      </div>
    );
  } else if (scan.phase === 'error') {
    body = (
      <p className="wc-err" role="alert">
        {scan.message}
      </p>
    );
  } else {
    const genuine = scan.reports.filter((r) => r.verdict === 'genuine');
    const notStock = scan.reports.filter((r) => r.verdict === 'not-stock-token');
    const unverified = scan.reports.filter((r) => r.verdict === 'unknown');
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const extras = [
      notStock.length ? `${plural(notStock.length, 'token', 'tokens')} that reuse a Stock Token symbol but are not Stock Tokens` : '',
      unverified.length ? `${plural(unverified.length, 'token', 'tokens')} that could not be verified` : '',
    ].filter(Boolean);
    body = (
      <>
        <p className="wc-sum" aria-live="polite">
          {genuine.length
            ? `${plural(genuine.length, 'Stock Token', 'Stock Tokens')} with a balance`
            : 'No Stock Token balances found'}
          {extras.length ? `, plus ${extras.join(' and ')}` : ''}. Scanned {scan.total} candidates at{' '}
          {scan.at.toLocaleTimeString()}.
          {scan.unread > 0 && ` ${scan.unread} could not be read; scan again later.`}
        </p>
        {genuine.length > 0 && (
          <div className="tcards">
            {genuine.map((r) => (
              <TokenCard key={r.address} report={r} holding />
            ))}
          </div>
        )}
        {unverified.length > 0 && (
          <>
            <h3 className="wc-sub">Could not be verified</h3>
            <p className="small muted">
              The wallet’s RPC did not answer, or the factory’s records disagree; each card gives the reason. Scan again
              later. These may be real Stock Tokens: the verdict is unknown, not negative.
            </p>
            <div className="tcards">
              {unverified.map((r) => (
                <TokenCard key={r.address} report={r} holding />
              ))}
            </div>
          </>
        )}
        {notStock.length > 0 && (
          <>
            <h3 className="wc-sub">Not Stock Tokens</h3>
            <p className="small muted">
              These reuse a Stock Token symbol. The symbol proves nothing; the verdict comes from the on-chain checks.
            </p>
            <div className="tcards">
              {notStock.map((r) => (
                <TokenCard key={r.address} report={r} holding />
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div className="wc-card panel">
      <div className="wc-head">
        <h2 className="wc-h">Stock Token holdings</h2>
        {ok && (
          <button type="button" className="btn btn-secondary" onClick={() => void run()} disabled={scan.phase === 'running'}>
            Scan again
          </button>
        )}
      </div>
      {body}
      <p className="small muted wc-scope">
        Scans {summary.tokens} Stock Tokens and {summary.lookalikes} lookalikes. The list was built on {built} (block{' '}
        {summary.block.toLocaleString('en-US')}) from a public token list, keeping only addresses that pass the factory check;
        every address with a balance is checked again live. A Stock Token missing from that list, or issued later, is not
        scanned: check it by address below.
      </p>
    </div>
  );
}

type CheckState = { busy: boolean; report: TokenReport | null; error: string | null };
const EMPTY_CHECK: CheckState = { busy: false, report: null, error: null };

function AddressCheck() {
  const s = useWallet();
  const ok = s.status === 'connected' && onRobinhoodChain(s);
  const provider = s.wallet?.provider;
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [state, setState] = useState<CheckState>(EMPTY_CHECK);
  const req = useRef<AbortController | null>(null);

  // A result belongs to one wallet + network: drop it (and any check in flight) when either changes or disconnects.
  useEffect(() => {
    setState((prev) => (prev.busy || prev.report || prev.error ? EMPTY_CHECK : prev));
    return () => {
      req.current?.abort();
      req.current = null;
    };
  }, [ok, provider, s.account]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!isAddress(v)) {
      setHint(
        /^[a-z.$]{1,12}$/i.test(v)
          ? 'Enter a contract address, not a symbol: anyone can deploy a token with any name or symbol.'
          : 'Enter a contract address: 0x followed by 40 hex characters.',
      );
      return;
    }
    if (!hasValidChecksum(v)) {
      setHint('This address fails its EIP-55 checksum, so it probably has a typo. Paste it again, or in all lowercase.');
      return;
    }
    setHint(null);
    if (!ok || !provider) return;
    req.current?.abort();
    const c = new AbortController();
    req.current = c;
    setState({ busy: true, report: null, error: null });
    try {
      const [report] = await verifyTokens(provider, [v], undefined, c.signal);
      if (c.signal.aborted) return;
      setState({ busy: false, report, error: null });
    } catch (err) {
      if (c.signal.aborted || isAbort(err)) return;
      setState({ busy: false, report: null, error: err instanceof WrongNetworkError ? err.message : `Check failed: ${errorMessage(err)}` });
    } finally {
      if (req.current === c) req.current = null;
    }
  };

  return (
    <div className="wc-card panel" id="check">
      <h2 className="wc-h">Check a token address</h2>
      <p className="muted">
        Paste a contract address. The verdict is keyed by address only: names and symbols can be copied by anyone.
      </p>
      <form className="wc-form" onSubmit={onSubmit} noValidate>
        <label htmlFor="token-address" className="vh">
          Token contract address
        </label>
        <input
          id="token-address"
          className="wc-input mono"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setHint(null);
          }}
          placeholder="0x…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby="token-address-hint"
          aria-invalid={hint ? true : undefined}
        />
        <button type="submit" className={`btn btn-primary${state.busy ? ' btn-busy' : ''}`} disabled={!ok || state.busy}>
          {state.busy ? 'Checking…' : 'Check'}
        </button>
      </form>
      <p id="token-address-hint" className={`small ${hint ? 'wc-err' : 'muted'}`} role={hint ? 'alert' : undefined}>
        {hint ??
          (ok
            ? 'Reads go through your wallet: eth_getCode and eth_call only.'
            : s.status === 'connected'
              ? 'Switch your wallet to Robinhood Chain to run the check.'
              : 'Connect a wallet on Robinhood Chain to run the check.')}
      </p>
      {state.error && (
        <p className="wc-err" role="alert">
          {state.error}
        </p>
      )}
      {state.report && (
        <div aria-live="polite">
          <TokenCard report={state.report} holding={false} />
        </div>
      )}
    </div>
  );
}

/** Page-head action, so the first screen on a phone has one: connect, or switch network. Nothing once ready. */
export function WalletHeadAction() {
  const s = useWallet();
  const connected = s.status === 'connected' && !!s.account;
  if (connected && onRobinhoodChain(s)) return null;
  if (connected) {
    return (
      <div className="wc-head-cta rise" style={{ ['--d' as string]: '140ms' }}>
        <button
          type="button"
          className={`btn btn-accent${s.switching ? ' btn-busy' : ''}`}
          onClick={() => void switchToRobinhoodChain()}
          disabled={s.switching || s.pending}
        >
          {s.switching ? 'Confirm in your wallet…' : 'Switch to Robinhood Chain'}
        </button>
      </div>
    );
  }
  return (
    <div className="wc-head-cta rise" style={{ ['--d' as string]: '140ms' }}>
      <button
        type="button"
        className={`btn btn-accent${s.status === 'connecting' ? ' btn-busy' : ''}`}
        aria-haspopup="dialog"
        onClick={openPicker}
        disabled={s.status === 'connecting'}
      >
        {s.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    </div>
  );
}

export function WalletCheck({ summary }: { summary: ListSummary }) {
  return (
    <div className="wc-grid">
      <YourWallet />
      <Holdings summary={summary} />
      <AddressCheck />
    </div>
  );
}
