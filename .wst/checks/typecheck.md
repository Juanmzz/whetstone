---
id: typecheck
description: TypeScript compiles with no errors.
kind: deterministic
severity: block
tiers: [strict, light]
include: ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "package.json", "tsconfig.json"]
command: npm run typecheck
origin: [adr-0008]
version: 2
---

**`package.json` and `tsconfig.json` are in `include`** because both change what the
compiler sees (dependencies, `type`, the compiler options themselves) without any `.ts`
changing. Version bumped 1 → 2 so receipts minted against the narrower `include` are
re-earned.

The tsconfig is deliberately strict, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` included, because this project is a gate. A type hole here
mis-gates other people's work.

**When it fails:** fix the type, do not widen it. Reaching for `any` or a non-null
assertion to get past this check defeats its purpose; if the type is genuinely
unknowable, model it as `unknown` and narrow explicitly.

Deterministic checks may block freely (constitution non-negotiable 7); there is no
ambiguity in whether the compiler succeeded.
