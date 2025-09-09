import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve the Mini App
app.use('/', express.static(path.join(__dirname, 'miniapp')));

// Health check
app.get('/healthz', (_, res) => res.send('ok'));

// DEX Screener passthrough
app.get('/api/market/:chain/:pair', async (req, res) => {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${req.params.chain}/${req.params.pair}`);
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Jupiter quote + swap → Phantom deeplink (sign & SEND)
app.post('/api/swap', async (req, res) => {
  try {
    const { inputMint, outputMint, amount, slippageBps, userPubkey } = req.body;

    const quoteURL = new URL('https://quote-api.jup.ag/v6/quote');
    quoteURL.searchParams.set('inputMint', inputMint);
    quoteURL.searchParams.set('outputMint', outputMint);
    quoteURL.searchParams.set('amount', String(amount));
    quoteURL.searchParams.set('slippageBps', String(slippageBps));
    const quote = await (await fetch(quoteURL)).json();

    const swap = await (await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPubkey,
        wrapAndUnwrapSol: true,
        asLegacyTransaction: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    })).json();

    const txBase64 = swap.swapTransaction;
    const appUrl = process.env.MINI_APP_URL; // your Render https URL
    const deeplink = `https://phantom.app/ul/v1/solana/signAndSendTransaction?` +
      new URLSearchParams({ payload: txBase64, app_url: appUrl, redirect_link: appUrl }).toString();

    res.json({ deeplink });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Telegram bot (long polling)
if (!process.env.BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply('Open trading panel:', {
  reply_markup: {
    inline_keyboard: [[{ text:'Open Trading App', web_app:{ url: process.env.MINI_APP_URL } }]]
  }
}));
bot.launch().then(() => console.log('Bot up'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('HTTP on', PORT));
