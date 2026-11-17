# Backrooms multiplayer

Node server (Express + ws) that serves `public/` and relays player positions. No usernames: everyone is an identical hazmat avatar.

## Run locally
npm install && npm start  → open http://localhost:3000 in two tabs

## Deploy
1. Push this folder to a GitHub repo.
2. On render.com: New → Web Service → pick the repo (render.yaml is picked up; or Build `npm install`, Start `npm start`).
3. Share the onrender.com URL. Free instances sleep when idle, so the first load can take ~30 s.

## Notes
- The server picks one world seed and sends it to everyone, so all players share the same maze. It resets when the last player leaves.
- Monsters, balloons and bodies still run on each player's own machine (see chat notes).
- hazmat.glb has a single clip: walking = normal speed, sprinting = faster playback, standing = that clip frozen on its first frame.
