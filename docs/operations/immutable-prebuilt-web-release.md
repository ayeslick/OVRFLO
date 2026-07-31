# Immutable prebuilt web release

The normal `npm --prefix web run build` first requires
`OVRFLO_DEPLOYMENT_ARTIFACT` and `DEPLOYMENT_RPC_URL`, re-verifies the exact
factory/lending anchors against chain state, and checks every public deployment
field against that artifact. It then stages CSP data only under ignored
build/output directories, hashes the exported inline scripts, verifies static
output, and compares the tracked diff before and after success or failure.

For Vercel:

1. Run the immutable web build with the production configuration.
2. Run `vercel build` once to create `.vercel/output`.
3. Run `npm --prefix web run package:vercel`. It prepends one continuing header
   route, records the original route digest, recomputes inline-script hashes
   from the packaged static HTML, verifies no localhost, verifies the adapter
   routes were preserved, and prints an artifact SHA-256.
4. Bind commit, environment profile, verified deployment anchor, artifact
   digest, provider evidence, and preview URL in the release record.
5. Promote with `vercel deploy --prebuilt`. Do not run Next or Vercel build
   again between verification and promotion.

Any source commit, environment value, deployment anchor, generated route,
security header, or artifact digest change invalidates prior evidence and
requires a new candidate.
