require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// --- Telegram Bot ---
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 Привет! Чтобы получить доступ к информации, нажмите кнопку ниже для проверки подписки.', {
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🔎 Проверить подписку',
          web_app: { url: webAppUrl }
        }]
      ]
    }
  });
});

// --- WebApp (Express) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const BOT_TOKEN = process.env.BOT_TOKEN;

app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ ok: false, error: 'userId required' });
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_USERNAME}&user_id=${userId}`;
    const tgRes = await axios.get(url);
    const status = tgRes.data.result.status;
    const isMember = ['member', 'administrator', 'creator'].includes(status);

    if (isMember) {
      const message = "✅ **Спасибо за подписку!**\n\nТеперь вам доступен эксклюзивный контент. Нажмите на кнопку ниже, чтобы получить его.";
      
      bot.sendMessage(userId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{
              text: '🎁 Получить контент',
              url: process.env.SECRET_LINK || 'https://example.com/secret' 
            }]
          ]
        }
      }).catch(err => console.error("Failed to send message:", err)); 
    }

    res.json({ ok: true, isMember });

  } catch (e) {
    console.error(`Error checking subscription for userId=${userId}:`, e.response ? e.response.data : e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки на стороне сервера.' });
  }
});

app.listen(PORT, () => {
  console.log(`WebApp и бот запущены. WebApp: http://localhost:${PORT}`);
});