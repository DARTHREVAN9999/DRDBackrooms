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
- Every player death creates a separate fallen hazmat corpse that remains in the current shared world after that player respawns. All clients receive and render the same corpse.
- When a player starts or respawns, the server finds the living player nearest to that player's start/death position. The joining/respawning player is placed at a safe nearby point rather than directly inside the other player's avatar.
- Almond Water bottles are deterministic world pickups. When one player collects a bottle, the server tells every other player to remove that same bottle; late joiners also receive the collected-bottle list.
- When the last player disconnects, the server chooses a fresh world seed and resets session data, including the shared corpse list, for the next session. Session data is held in server memory and is not preserved across a Render service restart or redeploy.

## Almond Water and scenery

- Rare desks and bookshelves appear in generated chunks. Furniture blocks player and monster movement rather than acting as decoration only.
- Some desks and bookshelves contain an Almond Water bottle; many do not.
- Press **Space** beside a bottle to pick it up and drink it. A first-person drinking animation plays.
- Drinking Almond Water boosts sprint speed and increases the sprint bar capacity for 30 seconds.
- Natural bodies, red balloons and chairs are less common than before. Looking at a balloon for 0.075 seconds makes it pop regardless of distance, provided it has a clear line of sight.
- The torch no longer has yellow bands. Space still toggles the torch when no Almond Water bottle is close enough to collect.
- A small camera-style HUD in the upper corner shows a red recording light and the time survived.

## Corpse / Skin Stealer encounter

- Crossing a previously untouched natural fallen hazmat body or another player's corpse gives a single 30% chance to trigger the Skin Stealer encounter. Re-crossing that same body cannot grant another torch or roll another encounter.
- The creature first appears using the same hazmat player avatar model and follows behind the player for about 5–6 seconds. The disguise timer does not start until that player avatar is loaded and visible.
- It then changes to its monster model and begins chasing.
- If the player escapes, the creature has a 50% chance to despawn until another corpse encounter, or a 50% chance to disappear and respawn behind the player already attacking after a longer delay.
- One client owns each active Skin Stealer encounter and streams its position, facing, movement, disguise/monster form, and hidden/active state through the server. Other clients render that same shared creature instead of independently spawning their own copy.
- Remote monster models have a visible fallback representation if a client's model asset is still loading or cannot be cloned. A remote player is only harmed when the replicated monster is actually visible, preventing invisible collision deaths.
- Late joiners receive the current active encounter state. The server prevents two clients from owning separate Skin Stealer encounters at the same time.

## Notes

The game uses Three.js r128 and its matching GLTF loader utilities from their public CDNs. The player avatar is served from `public/hazmat.glb`. The monsters and map models embedded in `public/index.html` remain part of the complete game file.

## Normal monster audio

- The uploaded sound is included as `public/monster-chase.mp3` for browser playback, with the supplied audio-only MP4 retained separately as `public/monster-chase-source.mp4`.
- While the normal monster is chasing a player and is within 40 metres, the game plays short random 1.15–2 second excerpts. The closer it is to a listener, the louder and more frequent the excerpts become; within 3 metres they play at full volume.
- The client sends each excerpt choice and monster position to the multiplayer server. The server relays it to every connected player with a shared future playback timestamp, so everyone hears the same excerpt at approximately the same time. Each listener applies their own proximity-based volume.

## Shared multiplayer environmental events

The WebSocket server now relays the current blackout, chair encounter, balloon pop, Partygoer state, and normal roaming monster state. One client simulates each active event and streams snapshots; other clients render the same encounter in their own point of view. Remote chair, Partygoer, and normal monsters can catch nearby players only while their replicated models are visible. The server retains active event snapshots and popped balloon keys for players who join mid-session. Blackout start/end beeps have been removed.

## Latest gameplay updates
- Chair encounters are now placed from a deterministic per-world-chunk roll at a lower rate than balloons, natural bodies, and bookshelves.
- The chair monster's pathing speed is increased slightly.
- Solo respawns choose a fresh random safe location; when another living player is online, the existing nearest-player spawn behaviour remains in effect.
- The survival timer is displayed in the upper-left with a red recording indicator. It pauses when the game is paused and the death screen reports the final run time.
- A subtle VHS scanline, tracking and screen-jitter overlay is enabled while the player is alive.

## Wooden doors and the car park level

- After surviving more than 3 minutes on the yellow level, random wooden doors start appearing in corridors near you (at most 4 at a time, each client rolls its own). Walk up and press **Space** to open or close one. Stepping through an open wooden door teleports you to the car park.
- The car park is an infinite, dim concrete parking garage: 2 m square pillars with yellow/black hazard stripes, ceiling beams and a red pipe, and sparse strip lights. There are **no blackouts** and **no normal monster** there.
- Only the disguise (Skin Stealer) monsters hunt you in the car park. They spawn at random; half the time they walk behind you disguised as a player, half the time they appear as the monster and chase straight away. Walking over a body can still trigger them too.
- Metal doors in the car park (Space to open/close) lead into rooms with metal desks, machinery and cones. Almond Water sometimes sits on the desks. Dead bodies can spawn anywhere in the car park; balloons, chairs and wooden furniture never do.
- Dying returns you to the yellow level. Players on different levels cannot see each other or each other's monsters; the server keeps one disguise-monster encounter per level and respawns you beside the nearest living player on the same level.
- The yellow level's wallpaper now uses the olive chevron-stripe pattern, Almond Milk is renamed Almond Water everywhere, and natural dead bodies are slightly more common on every level.

## Latest changes (abyss, bodies, spawning)

- **Abyss pits:** holes in the yellow level now have sheer walls that fade to black. Walking into one makes you fall (the screen drops and fades out); you leave **no body** behind, and your torch is lost.
- **One monster per body:** the first time anyone walks over a body (player or natural) its single disguise-monster roll is used up for everyone, including players who join later. It can never trigger again.
- **Player bodies** now have blood pools like natural bodies.
- **Torch drops:** if you die carrying a torch it lies beside your body with the battery level it had when you died. Walk over it to pick it up (shared; whoever grabs it first takes it).
- **Respawning:** alone on a level you respawn at a random spot anywhere on the map. With others alive on the same level you respawn beside the nearest one.
- **Almond Water** uses `almond_water_from_backrooms.glb` (embedded in `index.html`) for world bottles, desks and the first-person drinking view.
- **Normal monster ambushes:** after you escape it, it now reappears behind you far more often and sooner, always silently (no flicker or blackout).
