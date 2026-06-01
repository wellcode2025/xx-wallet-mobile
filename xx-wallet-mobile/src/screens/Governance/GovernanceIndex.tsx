import { Link } from 'react-router-dom';
import {
  Banknote,
  Building2,
  ChevronRight,
  ExternalLink,
  Landmark,
  ScrollText,
  UserCog,
  Vote,
} from 'lucide-react';
import { TopBar } from '@/components/layout';

/**
 * Phase 4 Governance — landing index.
 *
 * Lists the six first-class governance surfaces the official xx web wallet
 * exposes (Preimages / Democracy / Council / Tech.comm. / Treasury /
 * Bounties), grouped into five mobile rows. Tech. comm. ships under
 * Council since the membership is a strict subset on xx — collapsing the
 * two halves what would otherwise be two near-empty screens.
 *
 * **Slice 0 (this slice):** none of the rows are yet wired to a detail
 * screen. The index landing page exists so the new Governance bottom-tab
 * has something to render. Each row is disabled with a "Coming in Slice
 * N" affordance plus a tap-through to the canonical forum discussion at
 * forum.xx.network — the single off-chain narrative source on xx (no
 * Polkassembly, no Subsquare; spike-confirmed 2026-05-18).
 *
 * Slices 1–5 each replace one row's "coming-soon" state with a real
 * detail route. Slice 1 wires Bounties. See
 * docs/ for the ordering.
 */

interface Row {
  title: string;
  subtitle: string;
  icon: typeof Landmark;
  /** Internal route when the slice is shipped; null when still "Coming". */
  to: string | null;
  /** Coming-soon label (e.g. "Slice 2"). Ignored when `to` is non-null. */
  comingIn?: string;
  forumPath: string;
}

const ROWS: Row[] = [
  {
    title: 'Bounties',
    subtitle: 'Active grants, curators, payout deadlines',
    icon: Banknote,
    to: '/governance/bounties',
    forumPath: '/c/governance/bounties',
  },
  {
    title: 'Democracy',
    subtitle: 'Referenda, public proposals, preimages',
    icon: Vote,
    to: '/governance/democracy',
    forumPath: '/c/governance/democracy',
  },
  {
    title: 'Council',
    subtitle: 'Members, motions, technical committee',
    icon: Building2,
    to: '/governance/council',
    forumPath: '/c/governance/council',
  },
  {
    title: 'Treasury',
    subtitle: 'Spending proposals and tips',
    icon: ScrollText,
    to: '/governance/treasury',
    forumPath: '/c/governance/treasury',
  },
  {
    title: 'My governance',
    subtitle: 'Your votes, delegations, and bonds',
    icon: UserCog,
    to: '/governance/me',
    forumPath: '',
  },
];

export function GovernanceIndex() {
  return (
    <>
      <TopBar title="Governance" />
      <div className="px-5 pt-5 pb-8 max-w-md mx-auto">
        <div className="flex items-start gap-3 mb-6">
          <div className="mt-0.5 shrink-0 w-10 h-10 rounded-2xl bg-xx-500/10 text-xx-500 flex items-center justify-center">
            <Landmark size={22} strokeWidth={1.75} />
          </div>
          <div className="text-sm text-ink-300 leading-relaxed">
            View xx network governance from your phone. Read-only views are
            rolling out across Phase 4; participate flows arrive in 4b. Use
            the official web wallet meanwhile for voting and proposing.
          </div>
        </div>

        <ul className="space-y-2">
          {ROWS.map((row) => (
            <GovernanceRow key={row.title} row={row} />
          ))}
        </ul>

        <a
          href="https://forum.xx.network/c/governance"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-300 active:text-xx-500 transition-colors"
        >
          Discuss governance at forum.xx.network
          <ExternalLink size={14} strokeWidth={1.75} />
        </a>
      </div>
    </>
  );
}

function GovernanceRow({ row }: { row: Row }) {
  const Icon = row.icon;
  const forumHref = row.forumPath
    ? `https://forum.xx.network${row.forumPath}`
    : null;

  // Shipped slice — render as a tappable Link with chevron, no
  // "Coming" badge, no nested forum link (the detail screen carries
  // forum links per-bounty).
  if (row.to) {
    return (
      <li>
        <Link
          to={row.to}
          className="block rounded-2xl border border-ink-800 bg-ink-900/40 p-4 active:bg-ink-800/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-xx-500/10 text-xx-500 flex items-center justify-center">
              <Icon size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base text-ink-100 truncate">
                {row.title}
              </h2>
              <p className="mt-0.5 text-sm text-ink-300">{row.subtitle}</p>
            </div>
            <ChevronRight
              size={18}
              strokeWidth={1.75}
              className="shrink-0 text-ink-400"
            />
          </div>
        </Link>
      </li>
    );
  }

  // Coming-soon slice — neutral chrome, "Coming · Slice N" badge, optional
  // forum link as the only tappable affordance.
  return (
    <li className="rounded-2xl border border-ink-800 bg-ink-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-ink-800 text-ink-300 flex items-center justify-center">
          <Icon size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base text-ink-100 truncate">
              {row.title}
            </h2>
            {row.comingIn && (
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-ink-800 text-ink-300 font-sans uppercase tracking-wide">
                Coming · {row.comingIn}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-300">{row.subtitle}</p>
          {forumHref && (
            <a
              href={forumHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-xx-500 active:text-xx-400 transition-colors"
            >
              Open forum thread
              <ExternalLink size={13} strokeWidth={1.75} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
