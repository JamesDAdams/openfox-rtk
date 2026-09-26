# OpenFox RTK Plugin

A plugin for OpenFox that integrates [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) to optimize token consumption and rewrite shell commands into leaner, token-efficient executions.

## Features

- **CLI Detection**: Automatically detects `rtk` binary in PATH, Homebrew, and Cargo paths.
- **Command Rewriting**: Rewrites commands through `rtk rewrite` via RPC or tool execution.
- **Shell Compatibility**: Warns on Windows when cmd/PowerShell is active instead of Git Bash.
- **Tool**: Contributes `rtk_rewrite` tool for direct use in agent turns.

## Installation

```bash
cargo install rtk-cli
```

## Settings

- `status`: Displays current RTK CLI installation status.
- `enabled`: Toggle RTK token optimization on or off.
- `rtkPath`: Optional custom path to the `rtk` binary.
