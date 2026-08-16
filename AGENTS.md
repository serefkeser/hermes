# OTONOM repository instructions

- Every functional change must increment the patch version before it is committed. Run `npm run version:bump`, then `npm run version:check`.
- The header badge (`apps/web/src/version.ts`), workspace packages and Worker health responses must always report the same version.
- Keep automatic, secret-redacted diagnostic logging intact for every local video production. A completed, failed or recovered interrupted run must remain downloadable as a `.log` file.
