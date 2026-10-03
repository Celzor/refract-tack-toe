# Refract Tic-tac-toe

A little friendly competition, right inside your call. This public showcase implements a complete Refract activity: two players, live shared moves, spectators, scores, and rematches. It also works on its own against a computer or in pass-and-play mode.

**No game server. No account setup. No runtime dependencies.** Refract supplies identities and relays messages; this app supplies the game.

## Try it locally

With **Node.js 24 or later**:

```sh
npm run dev
```

No `npm install` is needed. Open:

- **[The game](http://127.0.0.1:4173/)** — play against a computer using perfect play, or choose pass & play.
- **[Shared activity preview](http://127.0.0.1:4173/tools/preview.html)** — two real game frames connected through a local simulation of Refract’s host protocol. Add a spectator, refresh a player, change themes, leave/rejoin, or start a new session.

For another port: `npm run dev -- --port 4200`. Opening `index.html` directly as a `file:` URL will not load browser modules; use the local server.

## Play in Refract

1. Publish the app at its own **HTTPS origin**, different from your Refract instance. GitHub Pages setup is below.
2. As an instance admin, open **Manage instance → Activities** and add:

   | Field | Value |
   | --- | --- |
   | Name | Tic-tac-toe |
   | URL | Your final hosted page URL, including its repository path if applicable |
   | Description | A little friendly competition. Two players, live moves, and room for spectators. |

3. Reload Refract so its content security policy picks up the activity origin.
4. Join a voice channel or private call. Open **Activities** in the call panel and select **Tic-tac-toe**.
5. Have a second person join the activity. The first two participants receive X and O; everyone else watches.

For development, register `http://127.0.0.1:4173/` on a non-production Refract instance or one with developer mode enabled. Each browser must be able to reach that address: a loopback URL points to the machine running that browser, so use HTTPS hosting for friends on other machines.

The URL must be its final origin; redirects to another domain break Refract’s origin checks. Hosting must allow framing by your Refract instance. If you configure `CSP_DIRECTIVES` manually in Refract, include the activity origin in `frame-src`.

## Publish on GitHub Pages

The included [workflow](.github/workflows/pages.yml) checks the JavaScript, runs the tests, builds a public-only `dist/`, and deploys it when changes reach `main`. Pull requests run checks without deploying.

1. Push this project to the repository.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Run **Check and deploy Pages** from Actions, or push to `main` after enabling Pages.
4. Copy the deployed URL from the workflow and register it in Refract.

For `Celzor/refract-tack-toe`, the default project URL would be `https://celzor.github.io/refract-tack-toe/`. This is the expected address, not a claim that Pages has already been enabled or published. All asset URLs are relative, so repository subpaths work.

Alternatively, run `npm run build` and serve **only `dist/`** from any static HTTPS host. Never deploy the whole working directory. The build has an explicit public-file allowlist; tests, tooling scripts, and local configuration stay out of the output.

## Game behavior

- First participant coordinates the shared state; only that copy accepts moves and publishes snapshots.
- Moves are validated against Refract’s relayed sender ID, player seat, turn, cell, round, and revision. Spectators cannot move or request rematches.
- First two participants occupy X and O. A joining spectator takes an empty seat if a player leaves; existing players keep their marks.
- A departed player’s unfinished board resets when seats change. Host departure starts a fresh round under the earliest remaining participant. Scores stay with **X/O**, including when someone new takes a seat.
- Completed rounds offer **Next round** to either player. Starting mark alternates each round.
- Late arrivals explicitly request a snapshot. A small periodic resync recovers missed messages; participants can also use **Resync game**.
- Snapshots are stored in each frame’s `sessionStorage`, scoped by session ID and user, to survive reloads. If the host reloads with storage unavailable, peers converge on its fresh board. This is an in-call game, not durable match history.
- New Refract session IDs create independent matches. Names are rendered as text. No Refract credentials or tokens are requested.
- Host light/dark theme, keyboard-accessible cells, reduced-motion preferences, mobile layouts, and a leave action are supported.

This is a cooperative casual-game protocol, not an anti-cheat service: the coordinating participant’s browser is trusted to publish state. There is no backend game referee.

## How the integration works

The wire contract is **`refract-activity/1`**. This repository uses its small, dependency-free [bridge](src/bridge.js), so the app does not need a local SDK checkout or a published SDK package.

```text
Activity frame       Refract host         Other participants
      ready ────────────► │
            ◄──── init   │  self, participants, sessionId, theme
      broadcast ────────►│──── message ───────────►
            ◄── message │◄──── broadcast ─────────
```

Incoming browser messages must originate from the framing window; a valid initialization pins that window’s origin. Messages within the activity use `refract-tac-toe/1`, the Refract session ID, and the elected host ID. Snapshots also carry the ordered membership list. State from a foreign sender, session, or roster is rejected.

Refract does not echo the sender’s broadcast or retain history. The coordinator applies its own changes locally, and other participants request a snapshot on initialization. Payloads remain below the 16 KiB protocol limit. The initial `ready` uses a wildcard target because the app can run on any Refract instance; subsequent messages target the validated host origin.

| File | Responsibility |
| --- | --- |
| [`src/game.js`](src/game.js) | Pure game rules, state validation, and computer opponent |
| [`src/session.js`](src/session.js) | Seats, authoritative moves, sync, rematches, and host changes |
| [`src/bridge.js`](src/bridge.js) | Refract postMessage boundary |
| [`src/app.js`](src/app.js) | UI, practice modes, and integration wiring |
| [`tools/preview.html`](tools/preview.html) | Multi-frame Refract protocol simulator |
| [`tests/`](tests/) | Game, synchronization, bridge, and static-serving checks |

## Development checks

```sh
npm run check
npm test
npm run build
```

The unit/integration suite uses Node’s built-in runner and in-memory relay, without a real Refract account. In environments that forbid child processes, run `node --test --test-isolation=none` instead.

An optional browser smoke test exercises the real UI and preview:

```sh
# Start npm run dev in another terminal first.
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tools/browser-check.mjs
```

It accepts `TEST_URL` (defaults to `http://127.0.0.1:4173/`), `PLAYWRIGHT_MODULE` for an existing Playwright installation, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for an existing Chromium browser. Screenshots go to ignored `artifacts/`. A protocol simulator verifies the app’s side of the contract; final end-to-end acceptance uses two signed-in users in an actual Refract call.

## License

GNU GPL v3. See [LICENSE](LICENSE).
