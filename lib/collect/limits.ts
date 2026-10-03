/**
 * The hard ceiling on one collection, under the contract's MAX_RECORDS (5,000)
 * with room for the unresolved rows an export may also carry.
 *
 * Its own module because both the server's admission path and the browser's
 * form need it, and the form must not import anything that reaches a database.
 */
export const ABSOLUTE_MAX_RECORDS = 4_970;
