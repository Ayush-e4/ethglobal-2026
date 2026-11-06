# Phone alerts (Telegram)

From the API ([api.md](api.md)).

| Route | |
|-------|--|
| `GET /alerts` | `{ available, linked }`: is Telegram set up on this server, and is your Telegram chat connected |
| `POST /alerts/telegram` | A one-time link to our bot (`https://t.me/<bot>?start=<code>`); tapping **Start** there connects that Telegram chat to your account |
| `POST /alerts/test` | Sends a test alert: `{ sent }` |
| `DELETE /alerts/telegram` | Disconnect (in Telegram, `/stop` does the same) |

Whenever the app writes in a chat by itself (booked, with the reference; refunded; a cheaper
rebook by PriceGuard), the chat's owner gets that message in Telegram too, with a link back to the
chat (`src/alerts`). The chat message is the record; the alert is a nudge, sent best effort.

- **Each hire, live** (`src/alerts/live-hires.ts`): one Telegram message per hire, with the
  hotel's photo, edited in place as it moves on (fee held, with **↩ Undo** in red until the
  window ends → booked, with the reference → paid out → rebooked cheaper → rated). Booked and
  paid-out hires get **1★–5★** buttons (a verified person's rating, as on the web: only with the
  account's linked World ID), and every hire a **Payment** button (HashScan). Buttons work only
  from the Telegram chat the hire's owner linked. Edits are silent; the chat's own messages are
  the alerts that buzz.
- **Commands** (`src/alerts/commands.ts`): the bot sets its menu (`/status`: the account's
  latest bookings and price watches; `/help`; `/stop`) and what people see before tapping Start.
- **The concierge in Telegram** (`src/alerts/telegram-chat.ts`): a connected Telegram chat talks to
  one Shikigami chat, with the same turns, tools and payments as the web, saved in that chat (so the
  web shows it too; `/new` starts another). The reply streams in as a draft (`sendMessageDraft`:
  "Thinking…", the tool being used, then the text as it's written) and is then sent for good, in
  Telegram's HTML. Offers are one carousel message: a hotel with its photo and details, **◀ ▶**
  between hotels, **📷** between that hotel's photos (up to 4), and a **Book** button per agent
  offering it ("StayWise: Book it, done · 0.02 USDC", "PriceGuard: Book and keep watching · 0.05
  USDC"), all edited in place; the concierge's pick comes after it. Choices are buttons. A World ID approval opens from a button, and once it passes the booking
  carries on in Telegram. A spending limit needs Face ID, so it points to that chat on the web;
  approved there, the booking carries on and its live message arrives in Telegram.
- **One thread per person.** A Telegram bot has one chat with each Telegram user, so alerts from
  all of an account's chats arrive in that one thread, each titled with its chat. One Telegram chat
  is connected to one account: connecting it to another account moves it.
- **Its own bot.** The server reads the bot's messages by long polling (no public address needed),
  and only one server may read a bot's messages, so each deployment needs its own bot from
  @BotFather (`TELEGRAM_BOT_TOKEN`). Without one, alerts are off and the Wallet page doesn't show
  them.

