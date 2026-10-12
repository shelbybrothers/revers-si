import type { Metadata } from 'next';
import Link from 'next/link';
import list from '@/public/data/stock-tokens.json';
import { WalletCheck, WalletHeadAction, type ListSummary } from './WalletCheck';

const DESCRIPTION =
  'Read-only Stock Token check for Robinhood Chain: connect a wallet, see which Stock Tokens it holds and whether each contract was issued by the Stock Token factory. No signatures.';

export const metadata: Metadata = {
  title: 'Wallet check',
  description: DESCRIPTION,
  alternates: { canonical: '/wallet' },
  openGraph: {
    url: '/wallet',
    title: 'Wallet check · revers.si',
    description: DESCRIPTION,
    images: [{ url: '/brand/revers-630.jpg', width: 630, height: 630, alt: 'revers.si logo' }],
  },
};

const summary: ListSummary = {
  tokens: list.tokens.length,
  lookalikes: list.lookalikes.length,
  generatedAt: list.generatedAt,
  block: list.block,
  source: list.source,
};

export default function WalletPage() {
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <div className="eyebrow rise">Wallet check</div>
          <h1 className="rise" style={{ ['--d' as string]: '60ms' }}>
            Check your Stock Tokens <em className="accent">without signing anything.</em>
          </h1>
          <p className="lede rise" style={{ ['--d' as string]: '120ms' }}>
            Connect a wallet on Robinhood Chain. revers.si reads, through your own wallet, which Stock Tokens it holds and checks
            each contract address against the Stock Token factory. Counterfeits copy names and symbols; they cannot copy the
            factory’s record.
          </p>
          <WalletHeadAction />
          <div className="meta-row rise" style={{ ['--d' as string]: '160ms' }}>
            <span className="chip chip-accent">read-only</span>
            <span className="chip">eth_call · eth_getCode · eth_getBalance</span>
            <span className="chip">Robinhood Chain · 4663</span>
            <span className="chip">
              list: {summary.tokens} Stock Tokens · {summary.generatedAt.slice(0, 10)}
            </span>
          </div>
        </div>
      </section>
      <section style={{ paddingBottom: 64 }}>
        <div className="wrap">
          <p className="small muted wc-oneline">
            Read-only · no signatures, transactions or approvals · nothing is sent to revers.si.{' '}
            <a href="#privacy">What your wallet sees</a>
          </p>
          <WalletCheck summary={summary} />
          <div className="panel note" id="privacy">
            <b>Read-only. Nothing is sent to revers.si.</b> revers.si asks your wallet only for your address and network and
            reads the chain through it with <code>eth_call</code>, <code>eth_getCode</code> and <code>eth_getBalance</code>.
            Your address and the reads go through your wallet to its RPC provider (the node your wallet uses for Robinhood
            Chain). revers.si never asks for a signature, a transaction or an approval. Nothing is stored on a revers.si
            server; this browser remembers only which wallet you picked. Not investment advice; not an audit. revers.si is an
            independent project, not affiliated with or endorsed by Robinhood.
          </div>
          <div className="panel note">
            <b>What “genuine” means here.</b> Every Stock Token answers <code>uid()</code>, and the Stock Token factory records
            which address it deployed for each uid. A token is genuine when the factory’s <code>tokenAddress(uid)</code> returns
            this exact address, or, if that mapping cannot be read, when this address equals the factory’s CREATE2 address for
            that uid (computed in your browser, so it does not rely on the RPC). A pass on the factory mapping alone relies on
            your wallet’s RPC; only the CREATE2 check does not. If the factory’s record contradicts a CREATE2 match, the verdict
            is unknown. “Genuine” means “issued by the Stock Token factory”, not “currently listed” or “tradable”. The factory
            address is not published in Robinhood’s docs: we identified it on chain, where every token in Robinhood’s published
            list (snapshot of 2026-10-08) was deployed by it. Code hash and pause flags are shown for context only, because a
            clone can copy them. Method, sources and limits are in <Link href="/docs#wallet">the docs</Link>.
          </div>
        </div>
      </section>
    </>
  );
}
