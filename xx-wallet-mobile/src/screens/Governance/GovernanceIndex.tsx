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
 * Governance landing index.
 *
 * Lists the governance surfaces the official xx web wallet exposes
 * (Preimages / Democracy / Council / Tech. comm. / Treasury / Bounties),
 * grouped into five mobile rows. Tech. comm. is shown under Council because
 * its membership is a strict subset of the council on xx — collapsing the
 * two avoids two near-empty screens. Each row taps through to its detail
 * surface; the footer links to the canonical off-chain discussion at
 * forum.xx.network (xx has no Polkassembly or Subsquare instance).
 */

interface Row {
  title: string;
  subtitle: string;
  icon: typeof Landmark;
  to: string;
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
      <TopBar title="Governance" showSettings />
      <div className="px-5 pt-5 pb-8 max-w-md mx-auto">
        <div className="flex items-start gap-3 mb-6">
          <div className="mt-0.5 shrink-0 w-10 h-10 rounded-2xl bg-xx-500/10 text-xx-500 flex items-center justify-center">
            <Landmark size={22} strokeWidth={1.75} />
          </div>
          <div className="text-sm text-ink-300 leading-relaxed">
            View and participate in xx network governance from your phone —
            read every surface, and vote, second, delegate, and propose
            directly.
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
