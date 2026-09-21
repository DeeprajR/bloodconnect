# Local access reference

Every URL, port and credential for the local development stack, in one place.

Nothing here is a secret. The infrastructure passwords live in
`docker-compose.yml` and `db/docker/init.sql`, both committed, and the seeded
staff password is printed by the seed runner. That is safe only because nothing
real ever runs against this stack. The seed refuses to run with
`NODE_ENV=production`, and the compose file is not a deployment.

Bring the stack up with `pnpm bootstrap` (Docker, migrations, seed), then start
the applications with `pnpm dev` and the bot with `pnpm bot`.

## Applications

| Application | URL | Runs with | Who signs in |
|---|---|---|---|
| Staff app | http://localhost:3000 | `pnpm dev` | Doctor, blood centre, volunteer admin |
| Administration | http://localhost:3001 | `pnpm dev` | Administrator only |
| Bot worker | no HTTP port | `pnpm bot` | Telegram long polling, or the in-memory channel |

The two applications are separate deployments. A session cookie names the
application that issued it, so a cookie from one is inert in the other.

The bot opens no port. It polls Telegram, or runs entirely in process when
`CHANNEL=memory` is set.

## Seeded staff accounts

All four share one password, printed by `pnpm db:seed`.

```
BloodConnect!Demo2026
```

| Role | Email | Sign-in page | Lands on |
|---|---|---|---|
| Doctor | doctor@blood-connect.invalid | http://localhost:3000/sign-in | http://localhost:3000/dashboard |
| Blood centre | centre@blood-connect.invalid | http://localhost:3000/sign-in | http://localhost:3000/centre |
| Volunteer admin | volunteer@blood-connect.invalid | http://localhost:3000/sign-in | http://localhost:3000/volunteer |
| Administrator | admin@blood-connect.invalid | http://localhost:3001/sign-in | http://localhost:3001/doctors |

The domain is `.invalid`, which RFC 2606 reserves so it can never resolve. A
seeded identifier cannot collide with a real person.

## Pages that need no account

| Page | URL |
|---|---|
| Public demand board | http://localhost:3000/board |
| Staff app landing | http://localhost:3000 |
| Password reset | http://localhost:3000/reset |
| Staff health check | http://localhost:3000/api/health |
| Administration health check | http://localhost:3001/api/health |

Invite and email-confirmation links carry a token in the path and arrive by
mail, so read them out of Mailpit rather than typing them.

## Infrastructure

| Service | URL or host | Username | Password |
|---|---|---|---|
| Postgres | `localhost:5433` | see the database roles below | see the database roles below |
| Mailpit web inbox | http://localhost:8025 | none | none |
| Mailpit SMTP | `localhost:1025` | any value accepted | any value accepted |
| MinIO S3 API | http://localhost:9000 | `minioadmin` | `minioadmin` |
| MinIO console | http://localhost:9001 | `minioadmin` | `minioadmin` |

Postgres is on 5433, not 5432, so a natively installed server cannot be reached
by accident. Mailpit accepts any SMTP credentials, including none, because
`MP_SMTP_AUTH_ACCEPT_ANY` is set. The MinIO bucket is `blood-connect` and its
anonymous policy is `none`, so objects are only ever served through an
authenticated route.

## Database roles

Four connection strings, deliberately not interchangeable. The superuser exists
only because the container creates it.

| Role | Password | Database | Holds |
|---|---|---|---|
| `migrator` | `migrator` | `blood_connect` | DDL rights, applies migrations and seeds |
| `app_web` | `app_web` | `blood_connect` | Read/write `hospital`, read `reference`, nothing in `bot` |
| `app_bot` | `app_bot` | `blood_connect` | Read/write `bot`, read `reference`, contract columns of `hospital.donor_demand` |
| `postgres` | `postgres` | `blood_connect` | Container superuser |

The test database is `blood_connect_test`, owned by `postgres` and connected to
as `migrator`. The suite truncates every table between tests, so the harness
refuses any URL that is not named for testing.

Connection strings, as they appear in `.env`:

```
MIGRATION_DATABASE_URL=postgres://migrator:migrator@localhost:5433/blood_connect
DATABASE_URL=postgres://app_web:app_web@localhost:5433/blood_connect
BOT_DATABASE_URL=postgres://app_bot:app_bot@localhost:5433/blood_connect
TEST_DATABASE_URL=postgres://migrator:migrator@localhost:5433/blood_connect_test
```

Roles come from `db/docker/init.sql`, which Postgres runs only on first start.
A database that already exists will not re-run it. Use `docker compose down -v`
then `pnpm up` to start clean.

## Chat channel

| Setting | Value |
|---|---|
| Bot username | `cmck_blood_donor_bot` |
| Deep link | `https://t.me/cmck_blood_donor_bot?start=<request id>` |
| Token | `TELEGRAM_BOT_TOKEN` in `.env`, from @BotFather |

Set `CHANNEL=memory` to run with no token at all. Recruitment, screening,
confirmation and the stand-downs all work, and nothing leaves the process.

## Object storage

| Setting | Value |
|---|---|
| Endpoint | http://localhost:9000 |
| Region | `ap-south-1` |
| Bucket | `blood-connect` |
| Access key | `minioadmin` |
| Secret key | `minioadmin` |
| Path style | forced on |

Seal images are read back through http://localhost:3001/api/seal/&lt;id&gt;, which
requires an administrator session. The bucket itself serves nobody.

testdoctor@blood-connect.invalid
123456789011