/**
 * useSequentialTx — submit one or more extrinsics in order, each with
 * its own signature, waiting for finality between steps.
 *
 * Why this exists: the Ledger xx network app refuses nested calls
 * ("Call nesting not supported"), so flows the wallet normally submits
 * as one atomic `utility.batchAll` — bond+nominate, bond+validate,
 * chill+unbond — must become N sequential transactions for a Ledger
 * signer, with N device confirmations.
 *
 * Semantics difference callers must surface in the UI: a batchAll is
 * atomic (all or nothing); a sequence is not. If step 2 fails after
 * step 1 finalized, the chain keeps step 1's effect. Every sequence
 * we use is safe to be left half-done (bonded-but-not-nominating,
 * chilled-but-not-unbonded) and completable from the manage-stake
 * surface, but the error copy should say which step failed.
 *
 * For local accounts callers keep their single batchAll through this
 * same hook (a one-element sequence), so screens have one submit path
 * and one done-flag regardless of signer type.
 */

import { useCallback, useState } from 'react';
import type { ApiPromise } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { useTx, type SubmitOptions } from './useTx';

type TxBuilder = (api: ApiPromise) => SubmittableExtrinsic<'promise'>;

export interface SequenceStep {
  /** Short human label, used in "step N of M: <label>" error context. */
  label: string;
  build: TxBuilder;
}

export function useSequentialTx() {
  const { submit, reset: resetTx, status, txHash, error } = useTx();
  // 1-based step counter while running; 0 when idle.
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  // True only after EVERY step finalized — `status === 'finalized'` is
  // briefly true between steps and must not be used as the done signal.
  const [sequenceDone, setSequenceDone] = useState(false);
  // Which step failed, for error copy ("Step 2 of 2 — nominate — failed…").
  const [failedStep, setFailedStep] = useState<SequenceStep | null>(null);

  const reset = useCallback(() => {
    resetTx();
    setCurrentStep(0);
    setTotalSteps(0);
    setSequenceDone(false);
    setFailedStep(null);
  }, [resetTx]);

  const submitSequence = useCallback(
    async (steps: SequenceStep[], opts: SubmitOptions): Promise<void> => {
      setSequenceDone(false);
      setFailedStep(null);
      setTotalSteps(steps.length);
      for (let i = 0; i < steps.length; i++) {
        setCurrentStep(i + 1);
        try {
          // Resolves at finality, so each step's state change is on
          // chain before the next signature is requested.
          await submit(steps[i].build, opts);
        } catch (err) {
          setFailedStep(steps[i]);
          throw err;
        }
      }
      setSequenceDone(true);
    },
    [submit]
  );

  return {
    submitSequence,
    reset,
    /** Per-transaction status of the CURRENT step (from useTx). */
    status,
    txHash,
    error,
    currentStep,
    totalSteps,
    sequenceDone,
    failedStep,
  };
}
