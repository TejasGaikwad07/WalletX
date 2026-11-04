# WalletX

A small digital-wallet app built as a Turborepo monorepo: users sign in with a phone number, see a balance, add money from a (simulated) bank, and send money to other users peer-to-peer.

The project started from a course template (see [What is mine vs the course template](#what-is-mine-vs-the-course-template)). The P2P transfer feature, the hardened bank webhook, the integration tests and CI were added on top.

## Architecture

```mermaid
flowchart LR
    subgraph Apps
        UA["user-app<br/>Next.js :3001"]
        MA["merchant-app<br/>Next.js (skeleton)"]
        BW["bank-webhook<br/>Express :3003"]
    end
    subgraph Packages
        W["@repo/wallet<br/>p2pTransfer()"]
        DB["@repo/db<br/>Prisma client + schema"]
        UI["@repo/ui"]
        ST["@repo/store<br/>Recoil"]
    end
    PG[("PostgreSQL")]
    BANK["Bank<br/>(sends signed webhooks)"]

    UA --> W
    UA --> DB
    UA --> UI
    UA --> ST
    MA --> DB
    W --> DB
    BW --> DB
    DB --> PG
    BANK -- "POST /hdfcWebhook<br/>x-signature: HMAC-SHA256" --> BW
```

### How the money-moving parts work

- **P2P transfer** (`packages/wallet/src/p2pTransfer.ts`): one Prisma interactive transaction that looks up the recipient by phone, locks both `Balance` rows with `SELECT ... FOR UPDATE` (lowest `userId` first, so opposing transfers cannot deadlock), checks the idempotency key, checks funds, moves the money and inserts a `P2pTransfer` row. It rejects amounts `<= 0`, self-transfers, unknown recipients and insufficient funds. `(fromUserId, idempotencyKey)` is unique, so retrying with the same key returns the original transfer and moves no money.
- **Bank webhook** (`apps/bank-webhook/src/app.ts`): the body is validated with zod and must carry an `x-signature` header (hex HMAC-SHA256 of the raw body using `BANK_WEBHOOK_SECRET`). A payment is credited only if the `OnRampTransaction` is still `Processing`; the `Processing -> Success` update and the balance credit happen in one transaction, so a replayed webhook credits exactly once.
- **Amounts** are integers in paise (1 INR = 100). The `/p2p` form takes INR and converts.

## Running it

Prerequisites: Node 18+, npm, and PostgreSQL (local, Docker or [neon.tech](https://neon.tech)).

```bash
git clone https://github.com/TejasGaikwad07/WalletX.git
cd WalletX
npm install

# Postgres, e.g. with Docker
docker run -e POSTGRES_PASSWORD=mysecretpassword -d -p 5432:5432 postgres
```

Copy each `.env.example` to `.env` (`packages/db`, `apps/user-app`, `apps/bank-webhook`) and set the database URL. Set `BANK_WEBHOOK_SECRET` to a random string and use the same value wherever the webhook is called from.

```bash
cd packages/db
npx prisma migrate dev
npx prisma db seed
cd ../..

cd apps/user-app && npm run dev        # http://localhost:3001
cd apps/bank-webhook && npm run dev    # http://localhost:3003
```

### Google sign-in (optional)

Phone + password login works without any Google setup. To also enable "Sign in with Google":

1. Open the [Google Cloud Console](https://console.cloud.google.com/), create or pick a project, then go to **APIs & Services -> OAuth consent screen** and configure it (External, add yourself as a test user).
2. Go to **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**, application type **Web application**.
3. Add the authorized redirect URI `http://localhost:3001/api/auth/callback/google` (use your real origin in production).
4. Copy the client ID and secret into `apps/user-app/.env`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

   Keep `NEXTAUTH_URL` and `JWT_SECRET` set as in `.env.example`. Never commit `.env`.

On first Google sign-in the user is found (or created) by email, with a zero `Balance` row created in the same transaction. A Google user has no phone number yet, so they must add one on `/profile` before they can send or receive P2P transfers; `/p2p` says so until they do. Only verified Google emails are accepted. Signing in with Google as an email that already exists links to that account.

Log in with phone `1111111111`, password `alice` (see `packages/db/prisma/seed.ts`). `2222222222` / `bob` is also seeded, so you can send money between them at `/p2p`.

To call the webhook by hand, sign the exact body you send:

```bash
BODY='{"token":"token__1","user_identifier":"1","amount":"20000"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$BANK_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3003/hdfcWebhook -H "Content-Type: application/json" -H "x-signature: $SIG" -d "$BODY"
```

## Tests

The tests run against a real PostgreSQL, not mocks. **They `TRUNCATE` the tables, so use a throwaway database.**

```bash
# an empty database, with the schema applied
export DATABASE_URL_TEST="postgresql://postgres:mysecretpassword@localhost:5432/walletx_test"
DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

npm test
```

What is covered:

- successful transfer
- insufficient funds
- duplicate idempotency key (money moves once), including 5 concurrent requests with one key
- two parallel transfers that would together overdraw (only one succeeds)
- opposing simultaneous transfers (no deadlock)
- Google users: new, returning, linked by existing email, unverified email rejected, concurrent first sign-ins, phone validation, phone uniqueness (including a race for one number)
- webhook replay and concurrent replays (credit once), bad or missing signature, invalid payload, amount mismatch

GitHub Actions (`.github/workflows/ci.yml`) starts a Postgres service, runs the migrations and the tests on every push and pull request.

## What is mine vs the course template

**From the course template** (the starting repo this was forked from):

- The monorepo scaffolding: Turborepo, the shared eslint/tsconfig packages, `packages/ui` components and the Recoil `packages/store`.
- The original user-app shell: NextAuth credentials login, dashboard / transfer / transactions pages, Tailwind styling.
- The original Prisma models (`User`, `Balance`, `OnRampTransaction`, `Merchant`), seed data and the first bank-webhook and merchant-app skeletons.

**Added by me on the `feature/p2p-transfers` branch:**

- `P2pTransfer` model and migration, with the `(fromUserId, idempotencyKey)` unique constraint.
- `packages/wallet`: the locked, idempotent `p2pTransfer` function.
- The `/p2p` page, server action and transfer list in user-app.
- Bank webhook rewrite: zod validation, HMAC signature check, atomic once-only credit.
- Google sign-in: `GoogleProvider` next to the credentials login, `findOrCreateGoogleUser` / `setPhoneNumber` in `packages/wallet` (testable without calling Google), the `/profile` phone step, and a migration making `User.number` and `User.password` optional (Google users have neither at first; the unique index on `number` stays, since Postgres allows many NULLs).
- Auth fix: hash the password only when creating a user, and create the `Balance` row together with the user.
- The Jest integration test suite and the CI workflow.
- This README.

**Not done / known limits:**

- The "Add Money" card on `/transfer` is still the template's mock: it only redirects to the bank's website and does not create an `OnRampTransaction`. The webhook is exercised by the tests and `curl`, not by an end-to-end bank flow.
- `merchant-app` is still essentially the template skeleton.
- The Google sign-in redirect itself (the call to Google) is not covered by automated tests; only the user lookup/creation logic is.
- Login does zero input validation beyond presence checks, and signing in with an unknown phone number creates an account (template behavior).
- There is no deployment in this repo: no AWS Lambda, S3 or other cloud infrastructure code. It runs locally and in CI only.
