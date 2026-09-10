# Inbox

- [x] ~~to the plan add the c-panel dashboard where I can see health of all APIs, metrics, to the
  granular details.~~
  → Added as **P10 · Control panel** in [docs/build-plan.md](docs/build-plan.md). Health of every
  dependency checked by doing its job rather than pinging it, §11.9's silent-failure list as a
  board, per-route metrics, and a screen that follows one unit of blood end to end by correlation
  id. Administrator-only, in the admin app, with no clinical function. The hardware phases and
  demo readiness shifted to P11–P13; Milestone C moves to day ~82.

  **Built and shipped** in `fd1fad3`, recorded in
  [ADR 0014](docs/adr/0014-the-control-panel-and-what-it-cannot-see.md). Live at `/panel` in the
  administration app, with the trace screen at `/panel/trace` and the configuration view at
  `/panel/deployment`. Two things worth knowing about it: the bot publishes its own alerts across
  the schema boundary rather than the panel reading them, because the web release holds no grant
  on the bot's schema at all; and the container-stopping test earned its place on the first run by
  catching a storage tile that stayed green with MinIO stopped.
