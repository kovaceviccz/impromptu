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

Visit [impromptu.social](https://impromptu.social/) to join a live debate. A
staging environment is available at
[staging.impromptu.social](https://staging.impromptu.social/) for validating
changes from the `staging` branch before they reach production.

## Run locally

Docker Compose is the easiest way to run the project.

```sh
docker compose up --build
```

Compose starts a local PostgreSQL database. The API rebuilds its schema from the
private lobby migration on every startup, so local private lobbies are cleared
each time. No database credentials are needed in a root `.env` file.

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

Production deployment requires `DATABASE_URL` for the app and
`MIGRATION_DATABASE_URL` for migrations. Put the pooled and direct PostgreSQL
URLs in the ignored `deploy/.env` file, then run
`sh deploy/scripts/configure-github.sh true` to install both as GitHub
`production` secrets and enable automatic deployment from `main`. Commit each
schema change with a versioned migration in `apps/api/src/lobbies/migrations/`.
Each deployment runs pending migrations from the new image on the server before
starting the new app container. A migration failure stops the deployment.

## Documentation

More detailed project documentation is available at:

https://kovaceviccz.github.io/impromptu/docs/
