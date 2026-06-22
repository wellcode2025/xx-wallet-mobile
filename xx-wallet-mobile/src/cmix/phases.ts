/**
 * Coarse phases of bringing cMix messaging online, surfaced to the UI.
 *
 * The first connect registers the device with the mixnet and can take several
 * minutes; a bare spinner reads as "stalled". Reporting these real phases (each
 * fired as the corresponding step starts) lets the UI show a ticking checklist
 * so the user can see it's progressing, not stuck.
 */
export type ConnectPhase = 'loading' | 'opening' | 'connecting' | 'finalizing';

/** Display order of the phases (also the checklist order). */
export const CONNECT_PHASE_ORDER: ConnectPhase[] = [
  'loading',
  'opening',
  'connecting',
  'finalizing',
];

/** User-facing label per phase. */
export const CONNECT_PHASE_LABEL: Record<ConnectPhase, string> = {
  loading: 'Loading secure messaging',
  opening: 'Opening your encrypted store',
  connecting: 'Connecting to the mixnet',
  finalizing: 'Setting up your private channel',
};

/**
 * Rotating "why this is worth the wait" copy shown during the slow first
 * connect. Accurate to cMix: metadata privacy via batch mixing (~1000-message
 * anonymity sets), end-to-end encryption, and no servers / phone numbers /
 * accounts. The point is to make a multi-minute wait feel earned, not broken.
 */
export const CONNECT_STORY: string[] = [
  'Setting up the most private messaging there is — over the xx mixnet.',
  'cMix hides who you talk to, not just what you say. Almost nothing else does.',
  'Your messages are mixed with a thousand others, so the link between sender and recipient disappears.',
  'End-to-end encrypted and routed through a decentralized mixnet — no servers, no phone number, no account.',
  'This one-time setup registers your device with the network. After this, connecting is quick.',
  'Worth the wait: metadata privacy at a level the apps you know can’t offer.',
];
