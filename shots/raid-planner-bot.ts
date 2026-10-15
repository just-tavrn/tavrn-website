// SPDX-License-Identifier: Apache-2.0
//
// The demo's Raid Planner bot for the `components` scenes of make.ts (message components: protocol APPLICATIONS.md
// §5.10): a message that mentions it gets the sign-up card for Friday with buttons, a select menu and a link button;
// "Sign up" answers only for the person who clicked, the role menu updates the card, "Leave a note" opens a form.
// make.ts starts it with the installed @tavrn/bot of the tavrn-web checkout (run.sh copies this file next to make.ts):
//   TAVRN_BOT_NODE=<node> TAVRN_BOT_TOKEN=<app token> TAVRN_BOT_KEY_FILE=<file> TAVRN_BOT_STATE_DIR=<dir> vite-node raid-planner-bot.ts
// The website does not depend on @tavrn/bot, so its typecheck leaves this file out (tsconfig.json "exclude").
import { button, createBot, modal, row, select, textInput, withComponents } from "@tavrn/bot";

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return v;
}

const bot = createBot({
  node: env("TAVRN_BOT_NODE"),
  token: env("TAVRN_BOT_TOKEN"),
  keyFile: env("TAVRN_BOT_KEY_FILE"),
  stateDir: env("TAVRN_BOT_STATE_DIR"),
  joinPolicy: "eager",
});

const roles = [
  { label: "Tank", value: "tank", emoji: "🛡️", description: "Holds the boss on the north edge" },
  { label: "Healer", value: "healer", emoji: "💚", description: "Stacks left after the first pull" },
  { label: "Damage", value: "dps", emoji: "⚔️", description: "Stays inside the ring until phase two" },
];

/** The sign-up card; `damage` is the count of the damage dealers signed up so far. */
function card(damage = 2) {
  const content = withComponents(
    "Sign-ups for **Sunken Citadel (hard mode)** are open: Friday 21:00, pull at 21:15.",
    row(
      button({ label: "Sign up", customId: "raid:signup", style: "success", emoji: "✅" }),
      button({ label: "Bench me", customId: "raid:bench", style: "secondary" }),
      button({ label: "Leave a note", customId: "raid:note", style: "primary", emoji: "📝" }),
      button({ label: "Raid guide", url: "https://guides.nightowls.example/sunken-citadel" }),
    ),
    row(select("raid:role", roles, { placeholder: "Choose your role" })),
  );
  return {
    ...content,
    embeds: [
      {
        title: "Friday raid: Sunken Citadel",
        color: 0xf0a35e,
        fields: [
          { name: "🛡️ Tanks", value: "Jonas, Mira (2/2)", inline: true },
          { name: "💚 Healers", value: "Theo (1/2)", inline: true },
          { name: "⚔️ Damage", value: `Lena, Kai (${damage}/6)`, inline: true },
        ],
        footer: "Reminder one hour before the pull",
      },
    ],
  };
}

const name = (address: string) => {
  const local = address.split("@")[0] ?? address;
  return local.charAt(0).toUpperCase() + local.slice(1);
};

bot.on("message", async (m) => {
  if (!m.mentionsMe || m.authorKind !== "user") return;
  await m.reply(card());
});

bot.component("raid:signup", async (i) => {
  await i.ephemeral(`You are on the list for Friday, ${name(i.user)}. Bring flasks and the dodge bind ✅`);
});
bot.component("raid:bench", async (i) => {
  await i.ephemeral(`${name(i.user)}, you are on the bench for Friday; the raid lead calls you in if a seat opens.`);
});
bot.component("raid:role", async (i) => {
  await i.update(card(3));
});
bot.component("raid:note", async (i) => {
  await i.modal(
    modal(
      "raid:note-form",
      "A note for the raid lead",
      textInput("arrival", "When can you be there?", { placeholder: "For example 21:00", maxLength: 40, required: false }),
      textInput("note", "Note", { style: "paragraph", maxLength: 300, placeholder: "Anything the raid lead should know" }),
    ),
  );
});
bot.modal("raid:note-form", async (i) => {
  await i.reply(`Note from ${name(i.user)}: ${i.fields.note ?? ""}`);
});

bot.on("error", (e) => bot.logger.error("bot error", { error: e }));
const shutdown = async () => {
  await bot.stop();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await bot.start();
console.log(`ready ${bot.info.address}`);
