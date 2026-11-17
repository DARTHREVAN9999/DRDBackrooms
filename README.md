# The Backrooms — Multiplayer

This is the complete game project. Render serves the game from `public/` and runs the multiplayer WebSocket server from `server.js`.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` in two browser tabs to test multiplayer.

## Deploy to Render

Create a **Web Service** from the repository root with:

- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Root directory: leave blank
- Docker: do not select Docker; this project does not use a Dockerfile

The server binds to `0.0.0.0` and uses Render's `PORT` environment variable. `/healthz` returns a simple health check.

## Multiplayer behaviour

- The server provides one shared world seed to everyone in the session.
- Joining players receive the states of players already in the game.
- Player position, facing direction, movement, sprinting and death state are relayed over WebSockets.
- When a player starts or respawns, the server finds the living player nearest to that player's start/death position. The joining/respawning player is placed at a safe nearby point rather than directly inside the other player's avatar.
- When no other living player is online, the game's normal solo spawn is used.
- When the last player disconnects, the server chooses a fresh world seed for the next session.


## Corpse / Skin Stealer encounter

- Crossing a natural fallen hazmat body or another player's corpse triggers the Skin Stealer encounter.
- The creature first appears using the same hazmat player avatar model and follows behind the player for about 4–5 seconds.
- It then changes to its monster model and begins chasing.
- If the player escapes, the creature has a 50% chance to despawn until another corpse encounter, or a 50% chance to disappear and respawn behind the player already attacking.
- Balloon and natural-body spawn chances are reduced; chairs appear less frequently as exploration distance increases. Looking directly at a balloon for 0.6 seconds makes it pop regardless of distance, provided it is not blocked from view.
- One client owns each active Skin Stealer encounter and streams its position, facing, movement, disguise/monster form, and hidden/active state through the server. Other clients render that same shared creature instead of independently spawning their own copy.
- Late joiners receive the current active encounter state. The server prevents two clients from owning separate Skin Stealer encounters at the same time.

## Notes

The game uses Three.js r128 and its matching GLTF loader utilities from their public CDNs. The player avatar is served from `public/hazmat.glb`. The monsters and map models embedded in `public/index.html` remain part of the complete game file.
