
import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    shards: 'auto'
});

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DEFAULT_CHANNEL_ID = process.env.DEFAULT_CHANNEL_ID; 
const players = loadPlayers();
const data = loadData();

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
    const rankedData = data.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
    // return rankedData ? `${rankedData.tier} ${rankedData.rank} (${rankedData.leaguePoints} LP)` : 'Unranked';

    if (rankedData) {
      return {
        tier: rankedData.tier,
        division: rankedData.rank,
        lp: rankedData.leaguePoints
      }
    }

    return {
      tier: null,
      division: null,
      lp: null
    }
}

async function updateRanks() {
    for (const [puuid] of players) {
        players.get(puuid).rank = await getRank(puuid);
    }
    publishLeaderboard();
}

const ranks = [
  "CHALLENGER", "GRANDMASTER", "MASTER",
  "DIAMOND I", "DIAMOND II", "DIAMOND III", "DIAMOND IV",
  "EMERALD I", "EMERALD II", "EMERALD III", "EMERALD IV",
  "PLATINUM I", "PLATINUM II", "PLATINUM III", "PLATINUM IV",
  "GOLD I", "GOLD II", "GOLD III", "GOLD IV",
  "SILVER I", "SILVER II", "SILVER III", "SILVER IV",
  "BRONZE I", "BRONZE II", "BRONZE III", "BRONZE IV",
  "IRON I", "IRON II", "IRON III", "IRON IV",
  "UNRANKED"
];

function getSortedLeaderboard() {
  return [...players.entries()].sort((a, b) => {
      const rankA = `${a[1].rank?.tier ?? "UNRANKED"} ${a[1].rank?.division ?? ""}`.trim();
      const rankB = `${b[1].rank?.tier ?? "UNRANKED"} ${b[1].rank?.division ?? ""}`.trim();

      const indexA = ranks.indexOf(rankA);
      const indexB = ranks.indexOf(rankB);

      // Comparaison par rang
      if (indexA !== indexB) return indexA - indexB;

      // Comparaison par LP si même rang
      return (b[1].rank.lp ?? 0) - (a[1].rank.lp ?? 0);
  });
}

function formatLeaderboardEntry(username, tier, division, lp, index) {
  const tierText = tier ?? "Unranked";
  let divisionText = "";
  if (!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
    divisionText = division ? ` ${division}` : "";
  }
  
  const lpText = lp ? ` - ${lp} LP` : "";

  return `${index + 1}. ${username} : ${tierText}${divisionText}${lpText}`;
}

async function publishLeaderboard() {
    const channel = await client.channels.fetch(DEFAULT_CHANNEL_ID);
    if (!channel) return;
    
    let leaderboard = getSortedLeaderboard()
    .map(([ppuid, { username, rank }], index) => 
        formatLeaderboardEntry(username, rank.tier, rank.division, rank.lp, index)
    )
    .join("\n");
    
    if (!data.channelId) {
      const message = await channel.send(`🏆 **Classement :**\n${leaderboard}`);
      data.channelId = message.id;
      saveData();
    } else {
      const message = await channel.messages.fetch(data.channelId);
      if (message) await message.edit(`🏆 **Classement :**\n${leaderboard}`);
    }
}

client.on('messageCreate', async message => {
    if (message.content.startsWith('!add')) {
        const args = message.content.split(' ')[1];
        if (!args || !args.includes('#')) {
            return message.reply('Format invalide. Utilise : `!add MonPseudo#Tag`');
        }
        const [username, tag] = args.split('#');
        const puuid = await getSummonerId(username, tag);
        if (!puuid) return message.reply('Joueur non trouvé.');
        
        const rank = await getRank(puuid);
        players.set(puuid, { tag, username, rank });
        savePlayers();

        const tierText = rank.tier ?? "Unranked";
        let divisionText = "";
        if (!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier)) {
          divisionText = rank.division ? ` ${rank.division}` : "";
        }
        const lpText = rank.lp ? ` (${rank.lp} LP)` : "";
        const reply = message.reply(`Ajouté ${username}#${tag} avec rang ${tierText}${divisionText}${lpText}`);
        await updateRanks();

        setTimeout(async () => {
          await message.delete();
          (await reply).delete();
        }, 5000)
    }

    if (message.content === '!leaderboard') {
        publishLeaderboard();
    }
});

function loadPlayers() {
  if (!fs.existsSync('players.json')) return new Map();
  const rawData = fs.readFileSync('players.json');
  return new Map(Object.entries(JSON.parse(rawData)));
}

// Sauvegarder les données dans players.json
function savePlayers() {
  fs.writeFileSync('players.json', JSON.stringify(Object.fromEntries(players), null, 2));
}

// Charger la config depuis config.json
function loadData() {
  if (!fs.existsSync('data.json')) return {};
  return JSON.parse(fs.readFileSync('data.json'));
}

// Sauvegarder la config dans config.json
function saveData() {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

setInterval(async () => {
    await updateRanks();
    console.log('Classement mis à jour.');
}, 60000);

client.login(BOT_TOKEN);