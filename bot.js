/**
 * Simple Discord bot that forwards messages to a Worker and replies with AI responses.
 *
 * Note: Discord enforces a 2000 character limit on message content. The helper
 * `sendInChunks` (added below) ensures responses longer than that are split
 * into multiple messages so the bot doesn't receive a 50035 Invalid Form Body
 * error from the API.
 */
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
      // Send responses in chunks to respect Discord's 2000 character limit.
      await sendInChunks(message, data.response);
    }
  } catch (err) {
    console.error('Worker error:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);  // Bot token from environment variable

/**
 * Send a long message by splitting it into chunks <= 2000 characters.
 * Tries to split at code block boundaries or newlines for readability.
 * Falls back to slicing if necessary.
 */
async function sendInChunks(messageOrChannel, text) {
  if (!text) return;
  const MAX = 2000;

  // Normalize: sometimes caller is a Message (has .reply and .channel) or a Channel
  const sendFn = typeof messageOrChannel.reply === 'function'
    ? async (content) => messageOrChannel.reply(content)
    : async (content) => messageOrChannel.send(content);

  // Helper to split by code blocks first, preserving formatting when possible
  const parts = [];

  // Split by code blocks (```), keep the fences paired
  const codeFence = '```';
  if (text.includes(codeFence)) {
    const segments = text.split(codeFence);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i % 2 === 1) {
        // inside a code block - re-add fences
        parts.push(codeFence + seg + codeFence);
      } else if (seg) {
        parts.push(seg);
      }
    }
  } else {
    parts.push(text);
  }

  // For each part, further split into <= MAX chunks, trying to cut at newlines
  const chunks = [];
  for (const part of parts) {
    if (part.length <= MAX) {
      chunks.push(part);
      continue;
    }

    // Prefer splitting at double newlines, then single newlines, then spaces
    const separators = ['\n\n', '\n', ' '];
    let working = part;
    while (working.length > MAX) {
      let cut = -1;
      for (const sep of separators) {
        const idx = working.lastIndexOf(sep, MAX);
        if (idx !== -1) {
          cut = idx + sep.length;
          break;
        }
      }
      if (cut === -1) {
        // no separator found, hard cut
        cut = MAX;
      }
      chunks.push(working.slice(0, cut));
      working = working.slice(cut);
    }
    if (working.length) chunks.push(working);
  }

  // Send each chunk sequentially to preserve order
  for (const c of chunks) {
    // If chunk is just a raw segment without code fences and it's long, trim
    const toSend = c.length > MAX ? c.slice(0, MAX) : c;
    try {
      await sendFn(toSend);
    } catch (e) {
      // On failure, log and continue with next chunk
      console.error('Failed to send chunk:', e);
    }
  }
}