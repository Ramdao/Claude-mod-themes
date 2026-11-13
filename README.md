# Claude-mod-themes

Mods and themes for Claude CLI. Each mod is its own plugin; install only the ones you want.

| Mod | What it does |
| --- | --- |
| `tool-histogram` | `/nerd` opens a stats pane: tool usage bars, a text pie of tool share, an activity heatmap, tool-duration columns, token usage and per-turn trend charts. Also `/nerd history`, `/nerd export` and `/budget`. |
| `nerd-theme` | `/skin <name>` or `/skin random` switches the color scheme used by every nerd mod; color-codes tool rows and adds a duration and `+/-` card under them. |
| `nerd-band` | A stats row above the prompt: uptime, turns, tool calls, last turn time, cost, context, a per-turn trend and your top tool. |
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

Answer `y` to add the marketplace, then pick a scope. Swap `tool-histogram` for any mod in the table. To install all five, run the line once per mod name.

## tool-histogram

| Command | What it does |
| --- | --- |
| `/nerd` | Opens the stats pane. |
| `/nerd history` | Opens a pane with one row per past session (cost, turns, tool calls, spend bar) and totals. Sessions are kept between runs, the last 30. |
| `/nerd export [md\|json]` | Writes the session's numbers to `nerd-stats-<date>.md` (or `.json`) in the working directory, ready for a standup or PR. |
| `/budget <usd>` | Sets a spend limit. A toast appears at 80% and at 100%, and the pane shows a budget gauge. |
| `/budget deny on\|off` | Optionally blocks new tool calls once the limit is reached. Off by default. |
| `/budget off` | Clears the limit. `/budget` alone shows the current setting. |

Automatic, with no command needed:

- **Context warning:** a toast at 70% and again at 85% of the context window, suggesting `/compact`.
- **Slow tool alert:** a tool call running longer than 15 seconds shows a live timer in the status line, such as `⏱ Bash running 42s`.

The pane sections: session (cost, context, budget), tools (bars, share, slowest), tool share (a text pie drawn with half-block characters, so no image support is needed), activity (a heatmap of when each top tool ran), tool duration (colored columns from fast to slow), and tokens (cache hit rate, stacked bar and per-turn charts). Long tool names are cut with an ellipsis to fit the pane.

## nerd-theme

`/skin` lists the themes: `cyan`, `amber`, `magenta`, `mono`, `nord`, `gruvbox`, `solarized`, `dracula`, `tokyo`. `/skin random` picks a different one. Add your own in the `THEMES` table at the top of the mod.

The mods share one color file, `nerd-theme.json`, in your Claude config folder (`CLAUDE_CONFIG_DIR`, otherwise `~/.claude`). `/skin` writes it. Without the file, every mod falls back to built-in cyan and green.

## Notes

- Written for the Claude Code plugin API and tested with `claude plugin test`; the tests sit beside each mod's `hooks/register.tsx`.
- The pie, heatmap, columns and trend charts all use plain text and 24-bit color, so they work in any modern terminal.

## License

MIT, see [LICENSE](LICENSE).
