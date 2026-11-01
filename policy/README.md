# Policy

This policy is a strong, opinionated default, separate from the reusable CLI. It uses linting and formatting to create a "pit of success": constraints that drive developers and agents toward correct, clear, explicit, and maintainable code.

Agentic development makes demanding enforcement practical. Rules need not justify their friction; even small code-quality improvements warrant inclusion. Oxlint's `correctness` and `suspicious` categories are included wholesale, with exceptions requiring a defense.

Inconvenience and existing violations are not reasons to weaken the policy. False positives, conflicting rules, and constraints that produce worse code are. The goal is better code—not better lint scores, unnecessary abstractions, or restrictions for their own sake.

Linting and formatting enforce what they can reliably check. They do not replace tests, review, or design judgment.
