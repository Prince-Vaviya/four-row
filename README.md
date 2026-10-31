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

## Publish on Render

1. Push this project to a GitHub repository.
2. In Render, create a **Web Service** connected to that repository.
3. Use `npm install && npm run build` as the build command and `npm start` as the start command.
4. Render supplies the public `onrender.com` URL. Share that URL or a room invite link with the other player.

The app uses one Node service for both the built web page and Socket.IO game server. Room state lives in server memory, which is a good fit for this small MVP. Rooms disappear when the service restarts, so start a fresh room if that happens. A free Render instance may take around a minute to wake after it has been idle.

Player seats can reconnect for 90 seconds using the browser's saved room token. No account, API key, or game database is required.
