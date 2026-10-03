import assert from 'node:assert/strict';
import { classifyAccessBlock } from '../src/access-guard.mjs';

const adsLibraryWithLoginText = classifyAccessBlock({
  href: 'https://www.facebook.com/ads/library/?q=test',
  hasAdsLibraryMarker: true,
  hasPasswordInput: false,
  hasLoginForm: false,
  hasCheckpointForm: false,
  bodySample: 'Ad Library Log in'
});
assert.equal(adsLibraryWithLoginText.blocked, false, 'Normal Ads Library must not fail just because Log in text exists');

assert.deepEqual(
  classifyAccessBlock({ href: 'https://www.facebook.com/login/?next=%2Fads%2Flibrary', hasAdsLibraryMarker: false }),
  { blocked: true, reason: 'login_url' }
);

assert.deepEqual(
  classifyAccessBlock({ href: 'https://www.facebook.com/checkpoint/123', hasAdsLibraryMarker: false }),
  { blocked: true, reason: 'checkpoint_url' }
);

assert.deepEqual(
  classifyAccessBlock({ href: 'https://www.facebook.com/', hasAdsLibraryMarker: false, hasPasswordInput: true, hasLoginForm: true }),
  { blocked: true, reason: 'login_form' }
);

assert.equal(
  classifyAccessBlock({ href: 'https://www.facebook.com/ads/library/', hasAdsLibraryMarker: true, hasPasswordInput: true, hasLoginForm: true }).blocked,
  false,
  'Ads Library marker wins over a generic login form elsewhere in the document'
);

console.log(JSON.stringify({ ok: true, cases: 5 }, null, 2));
