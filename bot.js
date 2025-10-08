const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // Required to read message content
  ],
});

const WORKER_URL = 'https://eva.valkyrja.link';  // Your Worker endpoint

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;  // Ignore bots (including self)

  // Forward ALL messages to Worker for memory (no guild ID filter)
  const shouldRespond = message.mentions.has(client.user) || message.content.startsWith('!ai');
  const payload = {
    sessionId: message.guild.id,  // Use dynamic guild ID
    input: message.content,
    author: message.author.id,
    respond: shouldRespond,
  };

  try {
    const res = await fetch(`${WORKER_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (shouldRespond && data.response) {
      await message.reply(data.response);  // Post AI response
    }
  } catch (err) {
    console.error('Worker error:', err);
  }
});

client.login('your-bot-token');  // Replace with your bot token