import type { Metadata } from 'next';
import Link from 'next/link';
import { SampleBadge } from '@/components/SampleBadge';
import { formatGenerated, formatUsd, results } from '@/lib/results';
import { LabClient } from './LabClient';

export const metadata: Metadata = {
  title: 'Lab results',
  description: 'Agents × scenarios matrix: every run, every check, every agent call, and the line of code behind each failure.',
  alternates: { canonical: '/lab' },
  openGraph: {
    url: '/lab',
    title: 'Lab results · revers.si',
    description: 'Agents × scenarios matrix: every run, every check, every agent call, and the line of code behind each failure.',
    images: [{ url: '/brand/revers-630.jpg', width: 630, height: 630, alt: 'revers.si logo' }],
  },
};

export default function LabPage() {
  const { generatedAt, mode, chain, sample, tasks, scenarios, runs, methodology, llmCost } = results;
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <div className="eyebrow rise">Lab</div>
          <h1 className="rise" style={{ ["--d" as string]: "60ms" }}>
            Leaderboard <em className="accent">and run detail.</em>
          </h1>
          <div className="meta-row rise" style={{ ["--d" as string]: "120ms" }}>
            <SampleBadge sample={sample} />
            <span className="chip">generated {formatGenerated(generatedAt)}</span>
            <span className="chip chip-accent">mode = {mode}</span>
            {chain.id !== null && <span className="chip">chain {chain.id}</span>}
            {chain.replicaOf !== null && <span className="chip">replica of {chain.replicaOf}</span>}
            {chain.forkOf !== null && <span className="chip">fork of {String(chain.forkOf)}</span>}
            <span className="chip">{scenarios.length} scenarios · {runs.length} runs</span>
            {llmCost && (
              <span className="chip" title="Estimated from token usage and public per-MTok prices; not an invoice">
                LLM spend ~{formatUsd(llmCost.totalUsd)} · {llmCost.runs} runs
              </span>
            )}
          </div>
          <p className="lede rise" style={{ ["--d" as string]: "160ms" }}>
            {tasks.length > 1 ? 'Tasks' : 'Task'}: {tasks.map((t) => `“${t.prompt}”`).join(' and ') || 'n/a'} Score = 100 × passed ÷
            applicable checks. A deferral that names the hazard in a hazardous market counts as a pass; doing nothing scores 0.
            Runs the agent crashed before its first call, or that the harness stopped (LLM spend cap, model refusal, API error),
            are marked error and left out of the leaderboard.
          </p>
        </div>
      </section>
      <section style={{ paddingBottom: 64 }}>
        <div className="wrap">
          <LabClient data={results} />
          <div className="panel note">
            <b>Methodology, honestly.</b>{' '}
            {methodology ? (
              <span>{methodology}</span>
            ) : (
              <span>
                Results come from replica mode: a local anvil chain that mirrors Robinhood Chain’s stock-token mechanics
                (registry, ERC-8056 multiplier, equity feeds, pauses), not mainnet. Reference agents are deliberately simple
                stand-ins for common agent patterns, not specific products.
              </span>
            )}{' '}
            LLM agents run only when an API key is configured and are otherwise listed as skipped, never simulated. No US
            holiday calendar in v0.
            {sample && (
              <>
                {' '}
                <b>This page currently shows sample data</b> derived from the spec; it is replaced by real lab output when the lab
                runs.
              </>
            )}{' '}
            Not investment advice; not an audit. See <Link href="/docs">the docs</Link> to reproduce.
          </div>
        </div>
      </section>
    </>
  );
}
