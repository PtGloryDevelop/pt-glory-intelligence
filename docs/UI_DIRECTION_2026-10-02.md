# Direction selection after workflow feedback

User rejected both appearance and workflow of the previous redesign. Home must
answer both: which owned ads warrant investigation and why; what creative,
copy, and offers competitors use. Preserve the light, clear visual preference.

Target journey: home evidence -> retain owned ad in one analysis workspace ->
find rival evidence across the catalog -> compare visible copy/offer/CTA ->
keep an experiment draft. Avoid exposing collection datasets as a prerequisite.

Three concept images were displayed independently in this exact visible order:

1. Review Desk: `C:/Users/PT_STORE/.codex/generated_images/01a0f673-2180-7cf2-925a-00bdc1c05d2f/exec-ff2dbd66-e2fa-498f-8d75-d161c7fb029f.png`
2. Product Lens: `C:/Users/PT_STORE/.codex/generated_images/01a0f673-2180-7cf2-925a-00bdc1c05d2f/exec-a5d7b079-baa6-4451-9a99-3afda0214ff0.png`
3. Creative Workspace: `C:/Users/PT_STORE/.codex/generated_images/01a0f673-2180-7cf2-925a-00bdc1c05d2f/exec-6fd4c3aa-6fd0-4331-b1a1-9315053bda6d.png`

These are design mocks; illustrative classifications, text and mappings are not
verified features or source facts. No app code was changed in this exploration.
Await the user's visual selection before implementation under Ideate.

Read-only review: current home ranks spend, not a genuine review worklist;
its review CTA always selects the highest spender. Rival search is dataset
scoped; page evidence lacks a comparison CTA; comparison hides copy and loses
unsaved draft text on navigation. Fix these as part of the selected journey.

Data: current CompanyAd lacks product, objective and new-contact cohort fields.
Reuse source /api/dashboard/recommendations reasons and /api/dashboard/analysis
scope through an authorized source bridge before claiming a ranked improvement
queue. Existing thresholds are not profit forecasts. Rival evidence can reuse
getDatasetAds or page evidence reads and existing media resolution. Offers must
cite observed copy/image and collection date; product relations need confirmation.

Live audit was blocked: Node REPL failed twice before browser bootstrap with
kernel asset path missing. No fresh browser or accessibility audit is claimed.
Concepts used the user's team reference and existing local preview screenshots.

## User-requested reference research

User next requested https://21st.dev/community/templates and other design refs.
Inspected public official preview screenshots, not signed-in product behavior:

- Settle: https://21st.dev/@uvain/templates/settle-payment-operations-dashboard
  Strong neutral typography and spacing; an evidence/exception banner has a
  direct queue action above summary cards. Borrow hierarchy rather than finance
  widgets. Local image: test-artifacts/design-references/settle-dashboard.png.
- Foreplay Swipe File walkthrough:
  https://www.foreplay.co/post/how-to-save-and-share-ads-with-your-swipe-file-in-foreplay
  Image-first catalog, keyword search, grouped saved evidence and an Ad Drawer
  overlay retaining the underlying catalog. Local images:
  test-artifacts/design-references/foreplay-library.png and foreplay-ad-drawer.png.
- Foreplay Lens walkthrough: https://www.foreplay.co/post/introduction-to-lens
  Actual owned creative thumbnails with selectable business metrics beneath;
  useful distinction between performance review and inspiration. Local image:
  test-artifacts/design-references/foreplay-creative-review.png.

Recommended direction: Settle's readable visual hierarchy plus Foreplay's
creative catalog/detail overlay. Home still answers both requested jobs:
owned investigations with reasons and competitor image/copy/offer evidence.
No template installation, purchase, app-code changes or new collection runs.

## Accepted direction and implementation

The user accepted the improved reference direction and authorized continued work. The new implementation uses Settle's neutral hierarchy and Foreplay's image-led catalog with native detail overlays. The later executive-direction document prioritizes competitor ads first observed in the last seven days; own evidence follows. Full-catalog search replaces the initial dataset gate. The earlier exploration-only statements above describe the previous stage, not the current implementation. Current verification and remaining data work are recorded in EXEC_DIRECTION_IMPLEMENTATION_2026-10-02.md and design-qa.md.
