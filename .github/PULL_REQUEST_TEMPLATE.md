<!--
Delete any section that has nothing to say. An empty heading is worse than no
heading: it reads as a claim that there was nothing to weigh, nothing to measure
and nothing left unchecked.

The prose that does NOT belong above the code belongs here. `comment-density`
evicts it; this is where it lands.
-->

## What changed

## What it rules out

The alternative you weighed and dropped, and why this one won. ADR-0017 says a
change with no seriously weighed alternative is a commit message rather than a
decision; the same test applies one level down. If nothing was ruled out, say so.

## Evidence

Measurements, `sig-` ids, ADR anchors. A number with no source is an opinion, and
a number true of THIS repo says so.

## Verification

What actually ran, and what it said.

## Not verified

What you did NOT check, and what would still catch it. This never shares a
sentence with the section above, for the reason the gate never lets "no checks
ran" share one with "all checks passed".
