# Security policy

## Scope

`@panda11445go/dsh-purge` is a local-only DSH plugin. It modifies the local
DeepSeek Harness installation that the user explicitly points it at, keeps
timestamped backups, and exposes a revert command. It does not ship install
scripts, does not run background services, and does not send the user's
prompts, files, or credentials anywhere.

## Intended use

The plugin is intended for authorized security research, red-team exercises,
and testing of language-model behavior on systems you own or are permitted to
test. You are responsible for complying with the laws and policies that apply
to you and for obtaining authorization before using it against third-party
systems or data.

## Reporting a vulnerability

Open a private security advisory on the upstream project
(<https://github.com/YuJunZhiXue/dsh-purge>) or contact the maintainer of this
port. Please do not include live credentials, API keys, or private user data in
a report.

## Supply chain

- The npm package is published from a pinned tarball with no `postinstall` or
  other install lifecycle scripts.
- Runtime dependencies are declared in `package.json`; the package does not
  fetch code at install time.
- Release artifacts are verified with the registry SHA-512 integrity value.
