# Impromptu

Impromptu is a CS 407 software engineering senior project created by:

- Elijah Douglass
- Marko Kovacevic
- Zain Sohail
- Pawani Surthi
- Lizzy Zhou

The application, available at impromptu.social, hosts real-time debates between
two speakers arguing opposing sides of a topic through live video and audio.
Spectators can watch, vote, and participate in chat.

## Features

- Two live debaters per topic
- Public and private lobbies with shareable join codes
- Live video and audio with LiveKit
- Spectator mode with chat
- Real-time voting

## Run locally

Docker Compose is the easiest way to run the project.

Set `DATABASE_URL` in the ignored root `.env` file to your Neon pooled
connection string. Set `MIGRATION_DATABASE_URL` to the direct connection string
for schema migrations.

Apply database migrations before starting the app:

```sh
npm run db:migrate
```

```sh
docker compose up --build
```

Then open:

http://localhost:5173

To stop the application:

```sh
docker compose down
```

## Development

Run the full project checks with:

```sh
npm run ci
```

Individual checks are also available:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Private lobby codes and creator identities are stored in PostgreSQL. Connected
participant presence and display names are provided by LiveKit. Account-backed
identity is not implemented yet; private lobby entry currently supports guests.

## Documentation

More detailed project documentation is available at:

https://kovaceviccz.github.io/impromptu/docs/
