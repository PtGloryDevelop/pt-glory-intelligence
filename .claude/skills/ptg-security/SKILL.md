---
name: ptg-security
description: Use before merge/release for PT Glory security review covering secrets, auth, RLS, server business rules, input validation, XSS/injection, and captured Meta session data.
---

# PT Glory Security Diff Review

Review the current change for security impact.

Check:

- secrets in client bundle/logs/database
- SocialAPIs/AI/Supabase service credentials
- captured Meta session data
- authentication bypass
- authorization/RLS gaps
- server-side business-rule enforcement
- unvalidated import/input
- SQL/injection/XSS risks
- unsafe URL/media rendering
- destructive actions without protection
- audit-log requirements
- excessive data exposure

Output:

- Critical/High/Medium/Low findings
- Exploit/impact explanation
- Concrete fix
- Tests required

Do not approve deployment with unresolved critical/high findings.
