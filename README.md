# Claude-mod-themes

Mods and themes for Claude CLI. Each mod is its own plugin; install only the ones you want.

| Mod | What it does |
| --- | --- |
| `tool-histogram` | `/nerd` opens a stats pane: tool usage bars, a text pie of tool share, tool-duration columns, token usage and per-turn trend charts. |
| `nerd-theme` | `/skin <name>` switches the color scheme (`cyan`, `amber`, `magenta`, `mono`) used by every nerd mod; also color-codes tool rows by status. |
| `nerd-band` | A quiet stats row above the prompt: uptime, turns, tool calls, last turn time. |
| `failure-log` | `/fails` opens a pane collecting failed or denied tool calls. |
| `file-tracker` | `/files` opens a pane listing every file Claude edited or wrote, with edit counts. |

## Install

At the prompt of a terminal session:

```
/plugin install tool-histogram --marketplace Ramdao/Claude-mod-themes
```

From a shell:

```
claude plugin install tool-histogram --marketplace Ramdao/Claude-mod-themes
```

Answer `y` to add the marketplace, then pick a scope. Swap `tool-histogram` for any mod in the table.

## Themes

The mods share one color file, `nerd-theme.json`, in your Claude config folder (`CLAUDE_CONFIG_DIR`, otherwise `~/.claude`). Install `nerd-theme` and run `/skin magenta` (or `cyan`, `amber`, `mono`) to write it. Without the file, every mod falls back to built-in cyan and green.

## Notes

- The pie chart is drawn with half-block characters, so it works in any terminal with 24-bit color; no image support is needed.
- The mods are written for the Claude Code plugin API and were tested with `claude plugin test`.
