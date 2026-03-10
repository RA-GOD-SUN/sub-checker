require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('=== MINIMAL DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!process.env.BOT_TOKEN);
console.log('====================');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const webhookUrl = `${webAppUrl}/webhook`;
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Обработка /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Привет! Это тестовая версия.');
});

// Обработка всех сообщений
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  console.log(`Получено сообщение: "${text}" от ${chatId}`);
  bot.sendMessage(chatId, `Вы написали: "${text}"`);
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL: ${webAppUrl}/webhook`);
});
