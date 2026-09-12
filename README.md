# Wargame AI

A web companion for tabletop naval wargames: describe the table, and an AI
opponent tells you how its ships move and fire each turn. It is a pure
frontend app — games live in the browser's local storage, and can optionally
be synced to a Google Drive folder.

See [CLAUDE.md](CLAUDE.md) for the rules the app implements.

## Development

```sh
npm ci
npm run dev      # http://localhost:5173
npm run lint
npm test
npm run build
```

Pushes to `main` are deployed to GitHub Pages by
[deploy.yml](.github/workflows/deploy.yml).

## Google Drive sync

Once set up, the game list and every game's state are mirrored to a Drive
folder of your choosing: each **Save** pushes the open game there, and on
app load the games in that folder replace whatever is on the device. That is
what lets you set a game up on a laptop and play it from a tablet.

The app talks to Drive straight from the browser with an OAuth client ID.
There is no server and no secret; the client ID is public.

### 1. Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project (or pick one) and enable the **Google Drive API** under
   *APIs & Services → Library*.
2. Under *APIs & Services → OAuth consent screen*, configure an **External**
   app. While it stays in *Testing*, add the Google accounts that will use the
   app as **test users** — Google does not require verification for those.
3. Under *APIs & Services → Credentials*, create an **OAuth client ID** of
   type **Web application**. Add every origin the app is served from to
   **Authorised JavaScript origins**, e.g.
   - `http://localhost:5173`
   - `https://<your-user>.github.io`

   No redirect URI is needed: the app uses the token flow of Google Identity
   Services, which works from a popup.
4. Copy the client ID (it ends in `.apps.googleusercontent.com`).

The app asks for the `https://www.googleapis.com/auth/drive` scope so that it
can list your folders for you to choose from.

### 2. Give the app the client ID

Any one of these works:

- **Locally:** copy [.env.example](.env.example) to `.env.local` and fill in
  `VITE_GOOGLE_CLIENT_ID`.
- **On GitHub Pages:** add a repository variable named `VITE_GOOGLE_CLIENT_ID`
  (*Settings → Secrets and variables → Actions → Variables*). The deploy
  workflow passes it to the build.
- **In the app:** paste it into the *OAuth client ID* field of the Drive sync
  dialog. This overrides the build's default and is remembered on the device.

### 3. Pick a folder

On the main menu, open **Google Drive sync → Set up**, sign in, and browse to
the folder the games should live in (or create one). If that folder already
holds games from another device, they replace the ones on this device — the
app asks first when both sides have games. An empty folder is seeded with the
games already on the device.

### What ends up on Drive

- `games.json` — the game list, as shown on the main menu.
- `game-<id>.json` — one file per game, its full state.

Google's access tokens last about an hour and cannot be renewed silently from
a page without a server. When one lapses the app shows **Drive: sign in**;
saves still land locally in the meantime and are pushed once you sign in
again.
