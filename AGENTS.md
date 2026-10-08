# AGENTS.md — openfox-rtk

Paths relative to `openfox-plugins/openfox-rtk/`.

## Purpose

OpenFox plugin integrating RTK (Rust Token Killer) to optimize token consumption by rewriting shell commands into lighter, more efficient versions.

## Stack

- TypeScript, ESM, tsup, vitest 3.x
- peerDep: `openfox` (not specified)

## Commands

```bash
npm run build      # tsup
npm test           # vitest run --passWithNoTests
npm run typecheck  # tsc --noEmit
```

## Project Map

```
src/
├── index.ts        # Entry point (register, RPCs, rtk_rewrite tool)
├── client.ts       # RTKClient (communication with RTK binary)
└── index.test.ts   # Unit tests
```

## Where to Look What

- **Modify RTK client** → `src/client.ts`
- **Add a setting** → `src/index.ts` (SETTINGS_SCHEMA)
- **Add an RPC** → `src/index.ts`

## Conventions

- `apiVersion: 2`, capabilities: `settings`, `rpc`, `tools`, `ui`
- ESM build only via tsup (sourcemap: false, target: node20)
- `openfox` is externalized (provided by host)

## Cross-Project Dependencies

**Consumes**: `openfox/plugin` (PluginRegistry, PluginContext).

**Consumed by**: OpenFox (loaded as plugin).

**Touchpoints**:

- `src/index.ts` (register)
- `src/client.ts` (RTKClient)

## Known Gotchas

- `dist/index.js` is the entry point loaded by OpenFox, not `src/`.
- RTK must be installed (`cargo install rtk-cli`) and found in PATH/Homebrew/Cargo.
- Warning on Windows if cmd/PowerShell is active instead of Git Bash.
- The plugin provides the `rtk_rewrite` tool for direct use in agent turns.

## Do Not Read / Do Not Touch

- `node_modules/`, `dist/`, `.git/`

## Further Reading

- [README.md](README.md) — overview

---

> After any change affecting structure, a command, a convention, an inter-project contract, or a primary flow, update this file in the same commit. If any information here is inaccurate, fix it.
