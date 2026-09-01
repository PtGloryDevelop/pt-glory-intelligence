# Definition of Done

A feature is done only when:

- approved scope/spec is satisfied
- every UI metric has a documented source or formula
- unsupported metrics are absent
- errors/empty/partial states are handled
- data-quality behavior is correct
- tests appropriate to risk are added and pass
- lint/typecheck/build pass
- authorization is server-enforced where needed
- secrets are not exposed to client code
- migration has rollback consideration when schema changed
- browser journey works for user-facing critical flows
- regression test exists for fixed bugs
- documentation/data contract updated if behavior changed

A feature is not done because it "looks correct" in one happy-path browser session.
