# Four in a Row

A bright, mobile-friendly multiplayer take on the classic. Create a room, share its link, and play with a friend on another device.

## Rules

- Two players take turns dropping one disc into any open column.
- Discs fall to the lowest open space in that column.
- The first player to connect four discs horizontally, vertically, or diagonally wins.
- If the board fills without a four-in-a-row, the game is a draw.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The development server proxies real-time connections to the game server.

To run the production build locally:

```sh
npm run build
npm start
```

Then open `http://localhost:3001`.

## Publish on Vercel

1. Push this project to the Git repository you want Vercel to use and import it into Vercel.
2. In Vercel, add an Upstash Redis database and connect it to this project. The integration provides `KV_URL`; the server also accepts `REDIS_URL` if you use another Redis provider.
3. Deploy with the Vite build settings: `npm run build`, output directory `dist`. The `/api/socket.io` function is included in the repository.
4. Share Vercel's public deployment URL or a room invite link with the other player.

Vercel hosts the web app and Socket.IO endpoint. Redis shares room state across function instances, so both players see the same game even if they connect to different instances. Vercel may close a WebSocket when its function reaches its maximum duration; the client reconnects and restores its room seat.

Player seats can reconnect for 90 seconds using the browser's saved room token. No player accounts are required. The Redis connection string is a private deployment secret; keep it in Vercel's environment settings rather than committing it to this repository.
