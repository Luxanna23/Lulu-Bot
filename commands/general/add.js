import { MessageFlags, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import { client } from "../../index.js";

dotenv.config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const DEFAULT_CHANNEL_ID = process.env.DEFAULT_CHANNEL_ID;

const players = loadPlayers();
const config = loadConfig();

export const data = new SlashCommandBuilder()
  .setName("add")
  .setDescription("Add a player to the leaderboard")
  .addStringOption((option) =>
    option
      .setName("username")
      .setDescription("The username of the player")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("tag")
      .setDescription("The tag of the player")
      .setRequired(true)
  );

export async function execute(interaction) {
  const username = interaction.options.getString("username");
  const tag = interaction.options.getString("tag");
  const puuid = await getSummonerId(username, tag);
  if (!puuid) return interaction.reply({ content: "Joueur non trouvé", flags: MessageFlags.Ephemeral });

  const rank = await getRank(puuid);
  players.set(puuid, { tag, username, rank });
  savePlayers();

  const tierText = rank.tier ?? "Unranked";
  let divisionText = "";
  if (!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank?.tier)) {
    divisionText = rank.division ? ` ${rank.division}` : "";
  }
  const lpText = rank.lp ? ` (${rank.lp} LP)` : "";
  interaction.reply(
    { content: `Added ${username}#${tag} with rank ${tierText}${divisionText}${lpText}`, flags: MessageFlags.Ephemeral }
  );
  await updateRanks();
}

async function getSummonerId(username, tag) {
  const url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${username}/${tag}?api_key=${RIOT_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  return data.puuid;
}

async function getRank(puuid) {
  const url = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}?api_key=${RIOT_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const rankedData = data.find(
    (entry) => entry.queueType === "RANKED_SOLO_5x5"
  );
  // return rankedData ? `${rankedData.tier} ${rankedData.rank} (${rankedData.leaguePoints} LP)` : 'Unranked';

  if (rankedData) {
    return {
      tier: rankedData.tier,
      division: rankedData.rank,
      lp: rankedData.leaguePoints,
    };
  }

  return {
    tier: null,
    division: null,
    lp: null,
  };
}

async function updateRanks() {
  for (const [puuid] of players) {
    players.get(puuid).rank = await getRank(puuid);
  }
  publishLeaderboard();
}

const ranks = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND I",
  "DIAMOND II",
  "DIAMOND III",
  "DIAMOND IV",
  "EMERALD I",
  "EMERALD II",
  "EMERALD III",
  "EMERALD IV",
  "PLATINUM I",
  "PLATINUM II",
  "PLATINUM III",
  "PLATINUM IV",
  "GOLD I",
  "GOLD II",
  "GOLD III",
  "GOLD IV",
  "SILVER I",
  "SILVER II",
  "SILVER III",
  "SILVER IV",
  "BRONZE I",
  "BRONZE II",
  "BRONZE III",
  "BRONZE IV",
  "IRON I",
  "IRON II",
  "IRON III",
  "IRON IV",
  "UNRANKED",
];

function getSortedLeaderboard() {
  return [...players.entries()].sort((a, b) => {
    const rankA = `${a[1].rank?.tier ?? "UNRANKED"} ${
      a[1].rank?.division ?? ""
    }`.trim();
    const rankB = `${b[1].rank?.tier ?? "UNRANKED"} ${
      b[1].rank?.division ?? ""
    }`.trim();

    const indexA = ranks.indexOf(rankA);
    const indexB = ranks.indexOf(rankB);

    return indexA - indexB;
  });
}

async function publishLeaderboard() {
  const channel = await client.channels.fetch(DEFAULT_CHANNEL_ID);
  if (!channel) return;

  const leaderboard = getSortedLeaderboard()
    .map(([puuid, player], index) => {
      const rank = `${player.rank?.tier ?? "UNRANKED"} ${
        player.rank?.division ?? ""
      }`.trim();
      const lp = player.rank?.lp ? ` - ${player.rank.lp} LP` : "";
      return `${index + 1}. ${player.username} : ${rank}${lp}`;
    })
    .join("\n");

  if (config.messageId) {
    const message = await channel.messages.fetch(config.messageId);
    message.edit(`🏆 **Classement :**\n${leaderboard}`);
  } else {
    const message = await channel.send(`🏆 **Classement :**\n${leaderboard}`);
    config.messageId = message.id;
    saveConfig();
  }
}

function loadPlayers() {
  if (!fs.existsSync("players.json")) return new Map();
  const rawData = fs.readFileSync("players.json");
  return new Map(Object.entries(JSON.parse(rawData)));
}

// Sauvegarder les données dans players.json
function savePlayers() {
  fs.writeFileSync(
    "players.json",
    JSON.stringify(Object.fromEntries(players), null, 2)
  );
}

// Charger la config depuis config.json
function loadConfig() {
  if (!fs.existsSync("config.json")) return {};
  return JSON.parse(fs.readFileSync("config.json"));
}

// Sauvegarder la config dans config.json
function saveConfig() {
  fs.writeFileSync("config.json", JSON.stringify(config, null, 2));
}
