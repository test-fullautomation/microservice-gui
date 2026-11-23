# sessions (demo)

A session manager as part of the GUI, not one service's tiles. Simulated
data: it controls nothing, and its buttons say what a real session
manager would do.

- **Navigator "Sessions"** (`nav.js`, a view in the nav rail with its list in the left pane, for every user:
  `"role": "user"`): the sessions of every bench, running first, then the
  finished ones; search; All / Running / Failed.
- **Stage view "Sessions"** (`view.js`): with no session chosen, an
  overview (counts, the running sessions as live cards, the finished ones
  in a grid); with one, its console: state and actions, progress, steps,
  devices (running) or result (finished), and the log.

The two are separate frames. What one passes to `ctx.reveal({ session })`
the shell makes the other's selection (`ctx.onSelection`), so picking a
session in either place shows it in both.

`sim.js` computes everything from the clock, so both frames agree without
talking: each bench runs one session per cycle (12-20 min), and the
sessions before it, their verdicts and logs follow from the cycle number.
A real session manager would deliver this plugin itself (`Meta.gui_plugin`)
bound to its service (`binds`, `grpc.call`), and `sim.js` would become
`ctx.call`s.
