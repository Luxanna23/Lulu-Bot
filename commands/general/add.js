import { MessageFlags, SlashCommandBuilder, EmbedBuilder } from "discord.js";
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
  if (!puuid)
    return interaction.reply({
      content: "Joueur non trouvé",
      flags: MessageFlags.Ephemeral,
    });

  const rank = await getRank(puuid, tag);
  players.set(puuid, { tag, username, rank });
  savePlayers();

  const tierText = rank?.tier ?? "Unranked";
  let divisionText = "";
  if (!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank?.tier)) {
    divisionText = rank?.division ? ` ${rank.division}` : "";
  }
  const lpText = rank?.lp ? ` - ${rank.lp} LP` : "";

  interaction.reply({
    content: `Added ${username}#${tag} with rank ${tierText}${divisionText}${lpText}`,
    flags: MessageFlags.Ephemeral,
  });
  await updateRanks();
}

async function getSummonerId(username, tag) {
  const url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${username}/${tag}?api_key=${RIOT_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  return data.puuid;
}

function platformFromTag(tag) {
  const t = String(tag || "").toUpperCase();
  if (t.startsWith("EUW")) return "euw1";
  if (t.startsWith("EUNE")) return "eun1";
  if (t === "NA" || t === "NA1" || t.startsWith("NA")) return "na1";
  if (t.startsWith("BR")) return "br1";
  if (t === "LAN" || t.startsWith("LA1")) return "la1";
  if (t === "LAS" || t.startsWith("LA2")) return "la2";
  if (t.startsWith("OCE") || t === "OC1") return "oc1";
  if (t.startsWith("TR")) return "tr1";
  if (t.startsWith("RU")) return "ru";
  if (t.startsWith("KR")) return "kr";
  if (t.startsWith("JP")) return "jp1";
  return "euw1";
}

async function getRank(puuid,tag) {
  const platform = platformFromTag(tag);
  try {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}?api_key=${RIOT_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      return { tier: null, division: null, lp: null };
    }

    const data = await response.json();
    const rankedData = data.find(e => e.queueType === "RANKED_SOLO_5x5");

    if (!rankedData) {
      return { tier: null, division: null, lp: null };
    }

    return {
      tier: rankedData.tier,
      division: rankedData.rank,
      lp: rankedData.leaguePoints,
    };
  } catch {
    return { tier: null, division: null, lp: null };
  }
}


async function updateRanks() {
  for (const [puuid, data] of players) {
    players.get(puuid).rank = await getRank(puuid, data.tag);
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
  "Unranked",
];

//pour les emotes
const rankEmojiMarkupByTier = {
  IRON: "<:iron:1355271339526717661>",
  BRONZE: "<:bronze:1355271334674042960>",
  SILVER: "<:silver:1355271338163441664>",
  GOLD: "<:gold:1355271332727619825>",
  PLATINUM: "<:platinum:1355271336737374329>",
  EMERALD: "<:emerald:1355272015199731942>",
  DIAMOND: "<:diamond:1355271331301818389>",
  MASTER: "<:master:1355271340835340410>",
  GRANDMASTER: "<:grandmaster:1355271343997714583>",
  CHALLENGER: "<:challenger:1355271342311866539>",
  UNRANKED: "<:unranked:1355984490534535229>"
};

function resolveRankEmoji(_guild, tierRaw) {
  const key = String(tierRaw || "UNRANKED").toUpperCase();
  return rankEmojiMarkupByTier[key] || rankEmojiMarkupByTier.UNRANKED;
}

function getSortedLeaderboard() {
  return [...players.entries()].sort((a, b) => {
    const rankA = `${a[1].rank?.tier ?? "Unranked"} ${
      a[1].rank?.division ?? ""
    }`.trim();
    const rankB = `${b[1].rank?.tier ?? "Unranked"} ${
      b[1].rank?.division ?? ""
    }`.trim();

    const indexA = ranks.indexOf(rankA);
    const indexB = ranks.indexOf(rankB);

    // Comparaison par rang
    if (indexA !== indexB) return indexA - indexB;

    // Comparaison par LP si même rang
    return (b[1].rank.lp ?? 0) - (a[1].rank.lp ?? 0);
  });
}

function formatLeaderboardEntry(username, tier, division, lp, index,  icon = "") {
  const tierText = tier ?? "Unranked";
  let divisionText = "";
  if (!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
    divisionText = division ? ` ${division}` : "";
  }

  const lpText = lp ? ` - ${lp} LP` : "";
  const iconPart = icon ? `${icon} ` : "";

  return `${index + 1}. ${iconPart}${username} : ${tierText}${divisionText}${lpText}`;
}

async function publishLeaderboard() {
  const channel = await client.channels.fetch(DEFAULT_CHANNEL_ID);
  if (!channel) return;

  const guild = channel.guild;

  const lines = getSortedLeaderboard().map(([_, { username, rank }], index) => {
    const icon = resolveRankEmoji(guild, rank?.tier || "UNRANKED");
    return formatLeaderboardEntry(username, rank?.tier, rank?.division, rank?.lp, index, icon);
  });

  // Découper en pages 
  let pages = paginateByChars(lines, 4096);
  if (pages.length === 0) {
    pages = [["_Aucun joueur pour l’instant_"]];
  }

  // 3) Upgrade config : passer d'un seul message à plusieurs (compat rétro)
  if (!Array.isArray(config.messageIds)) {
    config.messageIds = [];
    if (config.messageId) config.messageIds.push(config.messageId);
    delete config.messageId;
  }

  // créer chaque page 
  const newMessageIds = [];
  for (let i = 0; i < pages.length; i++) {
    let description = pages[i].join("\n");
    if (description.length > 4096) {
      description = description.slice(0, 4093) + "...";
    }

    const embed = new EmbedBuilder()
      .setTitle("🏆 Classement :")
      .setDescription(description)
      .setColor(0x2b2d31)
      .setFooter({ text: `Lulu Bot — Page ${i + 1}/${pages.length}` })
      .setTimestamp(new Date());

    const existingId = config.messageIds[i];
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        const edited = await msg.edit({ content: "", embeds: [embed] });
        newMessageIds.push(edited.id);
        continue;
      } catch {
      }
    }

    const sent = await channel.send({ embeds: [embed] });
    newMessageIds.push(sent.id);
  }

  // 5) Supprimer les anciennes pages en trop (si moins de pages maintenant)
  if (config.messageIds.length > pages.length) {
    const extras = config.messageIds.slice(pages.length);
    for (const id of extras) {
      try {
        const msg = await channel.messages.fetch(id);
        await msg.delete();
      } catch {
        // déjà supprimé / introuvable : on ignore
      }
    }
  }

  // 6) Sauvegarder les nouveaux IDs de messages
  config.messageIds = newMessageIds;
  saveConfig();
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

//pagination des embed 
function paginateByChars(lines, max = 4096) {
  const pages = [];
  let current = [];
  let len = 0;

  for (const line of lines) {
    // +1 pour le saut de ligne quand on join("\n"), sauf pour la 1re ligne
    const addLen = (current.length ? 1 : 0) + line.length;

    if (addLen > max) {
      // Cas extrême: une seule ligne dépasse la limite → on tronque
      const sliceLen = Math.max(0, max - (current.length ? 1 : 0));
      const truncated = line.slice(0, sliceLen || max - 1);
      if (current.length) pages.push(current);
      pages.push([truncated]);
      current = [];
      len = 0;
      continue;
    }

    if (len + addLen > max) {
      pages.push(current);
      current = [line];
      len = line.length;
    } else {
      current.push(line);
      len += addLen;
    }
  }

  if (current.length) pages.push(current);
  return pages;
}

// Rafraîchissement auto du classement
const AUTO_REFRESH_MS = 15 * 60 * 1000; 

client.once('ready', () => {
  console.log(`[Leaderboard] Auto-refresh every ${AUTO_REFRESH_MS / 60000} min`);
  setInterval(() => {
    updateRanks().catch(err => console.error('[Leaderboard] refresh error:', err));
  }, AUTO_REFRESH_MS);
});