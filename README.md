 Our project idea revolves around the theme of System Design. Our project details are as follows:

Idea: Two players play a game together over the internet like both controlling a dot on screen, moving around in real time. We're building the "plumbing" that keeps their screens in sync, even when the internet connection is a bit slow or laggy. If Player A moves right, that message has to travel over the network to a server, then to Player B's screen. That takes time and makes movement feel sluggish and floaty if you're not careful. The three pieces we are building:

1. The connection (WebSockets): a live, always-open pipe between each player's computer and a central server, so messages can fly back and forth instantly instead of the player having to "refresh."
2. The server as referee: the server is the single source of truth. It doesn't trust either player's computer blindly. Every fraction of a second (a "tick"), it looks at what buttons each player pressed, updates the official game state, and tells both players what's really happening.
3. Making it feel instant despite lag:
Client-side prediction: when you press a key, your own screen moves your character immediately, without waiting for the server to confirm it. This makes the game feel snappy instead of delayed.
     b. Server reconciliation: a moment later, the server's "official" answer arrives. If it agrees with what we predicted, nothing changes. If it doesn't (say there was a collision we didn't know about), your screen gently corrects itself instead of teleporting us back so it still feels smooth, not jarring.

To concise, we're building a mini version of the same trick every online game (Fortnite, Rocket League, etc.) uses to feel responsive even though the computer and the server are talking over a laggy internet connection.

