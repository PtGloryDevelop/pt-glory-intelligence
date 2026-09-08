"use client";

/**
 * The ads behind one timeline bucket.
 *
 * P2.3 needed the same thing for a category, so the implementation moved to
 * components/EvidenceGrid. This name stays because the timeline reads better
 * with it, and because renaming a frozen call site buys nothing.
 */
export { EvidenceGrid as BucketEvidence, type EvidenceRow } from "@/components/EvidenceGrid";
